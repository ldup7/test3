import express from 'express';
import bodyParser from 'body-parser';
import axios from 'axios';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { OpenAIEmbeddings } from '@langchain/openai';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import { BraveSearch } from '@langchain/community/tools/brave_search';
import OpenAI from 'openai';
import cheerio from 'cheerio';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
const port = 3005;

app.use(bodyParser.json());

let openai = new OpenAI({
  baseURL: 'https://api.groq.com/openai/v1',
  apiKey: process.env.GROQ_API_KEY,
});
const embeddings = new OpenAIEmbeddings();

// Function to get DSPy system message
async function getSystemMessage(query, embedSources) {
  try {
    const response = await axios.post('http://localhost:5000/process-system-message', { query, embed_sources: embedSources });
    return response.data.system_message;
  } catch (error) {
    console.error('Error fetching system message:', error);
    throw error;
  }
}

// Function to get DSPy user message
async function getUserMessage(results) {
  try {
    const response = await axios.post('http://localhost:5000/process-user-message', { results });
    return response.data.user_message;
  } catch (error) {
    console.error('Error fetching user message:', error);
    throw error;
  }
}

// Function to search for sources using BraveSearch
async function searchEngineForSources(message) {
  const loader = new BraveSearch({ apiKey: process.env.GOOGLE_SEARCH_API_KEY });
  const docs = await loader.call(message, { count: numberOfPagesToScan });
  const normalizedData = normalizeData(docs);
  return await Promise.all(normalizedData.map(fetchAndProcess));
}

// Normalize search result data
function normalizeData(docs) {
  return JSON.parse(docs)
    .filter((doc) => doc.title && doc.link && !doc.link.includes("brave.com"))
    .slice(0, numberOfPagesToScan)
    .map(({ title, link }) => ({ title, link }));
}

// Fetch page content
const fetchPageContent = async (link) => {
  try {
    const response = await fetch(link);
    if (!response.ok) {
      return "";
    }
    const text = await response.text();
    return extractMainContent(text, link);
  } catch (error) {
    console.error(`Error fetching page content for ${link}:`, error);
    return '';
  }
};

// Extract main content from HTML
function extractMainContent(html, link) {
  const $ = html.length ? cheerio.load(html) : null;
  $("script, style, head, nav, footer, iframe, img").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}

// Fetch and process content
let vectorCount = 0;
const fetchAndProcess = async (item) => {
  const htmlContent = await fetchPageContent(item.link);
  if (htmlContent && htmlContent.length < 250) return null;
  const splitText = await new RecursiveCharacterTextSplitter({ chunkSize: textChunkSize, chunkOverlap: textChunkOverlap }).splitText(htmlContent);
  const vectorStore = await MemoryVectorStore.fromTexts(splitText, { link: item.link, title: item.title }, embeddings);
  vectorCount++;
  return await vectorStore.similaritySearch(message, numberOfSimilarityResults);
};

// Main POST endpoint
app.post('/', async (req, res) => {
  const { message, returnSources = true, returnFollowUpQuestions = true, embedSourcesInLLMResponse = false, textChunkSize = 800, textChunkOverlap = 200, numberOfSimilarityResults = 2, numberOfPagesToScan = 4 } = req.body;

  try {
    const sources = await searchEngineForSources(message, textChunkSize, textChunkOverlap);
    const sourcesParsed = sources.map(group =>
      group.map(doc => {
        const title = doc.metadata.title;
        const link = doc.metadata.link;
        return { title, link };
      })
        .filter((doc, index, self) => self.findIndex(d => d.link === doc.link) === index)
    );

    const systemMessage = await getSystemMessage(message, embedSourcesInLLMResponse);
    const userMessage = await getUserMessage(JSON.stringify(sources));

    const chatCompletion = await openai.chat.completions.create({
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: userMessage },
      ], stream: true, model: "mixtral-8x7b-32768"
    });

    let responseTotal = "";
    for await (const chunk of chatCompletion) {
      if (chunk.choices[0].delta && chunk.choices[0].finish_reason !== "stop") {
        process.stdout.write(chunk.choices[0].delta.content);
        responseTotal += chunk.choices[0].delta.content;
      } else {
        let responseObj = {};
        returnSources ? responseObj.sources = sourcesParsed : null;
        responseObj.answer = responseTotal;
        if (returnFollowUpQuestions) {
          const followUpQuestions = await generateFollowUpQuestions(responseTotal);
          responseObj.followUpQuestions = followUpQuestions;
        }
        res.status(200).json(responseObj);
      }
    }
  } catch (error) {
    console.error('Error handling POST request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});
