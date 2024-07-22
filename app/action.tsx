import 'server-only';
import { createAI, createStreamableValue } from 'ai/rsc';
import { OpenAI } from 'openai';
import cheerio from 'cheerio';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import { Document as DocumentInterface } from 'langchain/document';
import { OpenAIEmbeddings } from '@langchain/openai';
import { config } from './config';
import axios from 'axios';

// Configuration de l'API OpenAI
const openai = new OpenAI({
  baseURL: config.nonOllamaBaseURL,
  apiKey: config.inferenceAPIKey
});

const embeddings = new OpenAIEmbeddings({
  modelName: config.embeddingsModel
});

interface SearchResult {
  title: string;
  link: string;
  favicon: string;
}

interface ContentResult extends SearchResult {
  html: string;
}

export async function getSources(message: string, numberOfPagesToScan = config.numberOfPagesToScan): Promise<SearchResult[]> {
  try {
    const response = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(message)}&count=${numberOfPagesToScan}`, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY as string
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const jsonResponse = await response.json();
    if (!jsonResponse.web || !jsonResponse.web.results) {
      throw new Error('Invalid API response format');
    }
    const final = jsonResponse.web.results.map((result: any): SearchResult => ({
      title: result.title,
      link: result.url,
      favicon: result.profile.img
    }));
    return final;
  } catch (error) {
    console.error('Error fetching search results:', error);
    throw error;
  }
}

export async function get10BlueLinksContents(sources: SearchResult[]): Promise<ContentResult[]> {
  async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout = 800): Promise<Response> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      if (error) {
        console.log(`Skipping ${url}!`);
      }
      throw error;
    }
  }

  function extractMainContent(html: string): string {
    try {
      const $ = cheerio.load(html);
      $("script, style, head, nav, footer, iframe, img").remove();
      return $("body").text().replace(/\s+/g, " ").trim();
    } catch (error) {
      console.error('Error extracting main content:', error);
      throw error;
    }
  }

  const promises = sources.map(async (source): Promise<ContentResult | null> => {
    try {
      const response = await fetchWithTimeout(source.link, {}, 800);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${source.link}. Status: ${response.status}`);
      }
      const html = await response.text();
      const mainContent = extractMainContent(html);
      return { ...source, html: mainContent };
    } catch (error) {
      return null;
    }
  });

  try {
    const results = await Promise.all(promises);
    return results.filter((source): source is ContentResult => source !== null);
  } catch (error) {
    console.error('Error fetching and processing blue links contents:', error);
    throw error;
  }
}

export async function processAndVectorizeContent(
  contents: ContentResult[],
  query: string,
  textChunkSize = config.textChunkSize,
  textChunkOverlap = config.textChunkOverlap,
  numberOfSimilarityResults = config.numberOfSimilarityResults,
): Promise<DocumentInterface[]> {
  const allResults: DocumentInterface[] = [];
  try {
    for (let i = 0; i < contents.length; i++) {
      const content = contents[i];
      if (content.html && content.html.length > 0) {
        try {
          const splitText = await new RecursiveCharacterTextSplitter({ chunkSize: textChunkSize, chunkOverlap: textChunkOverlap }).splitText(content.html);
          const vectorStore = await MemoryVectorStore.fromTexts(splitText, { title: content.title, link: content.link }, embeddings);
          const contentResults = await vectorStore.similaritySearch(query, numberOfSimilarityResults);
          allResults.push(...contentResults);
        } catch (error) {
          console.error(`Error processing content for ${content.link}:`, error);
        }
      }
    }
    return allResults;
  } catch (error) {
    console.error('Error processing and vectorizing content:', error);
    throw error;
  }
}

export async function getImages(message: string): Promise<{ title: string; link: string }[]> {
  const url = 'https://google.serper.dev/images';
  const data = JSON.stringify({
    "q": message
  });
  const requestOptions: RequestInit = {
    method: 'POST',
    headers: {
      'X-API-KEY': process.env.SERPER_API as string,
      'Content-Type': 'application/json'
    },
    body: data
  };
  try {
    const response = await fetch(url, requestOptions);
    if (!response.ok) {
      throw new Error(`Network response was not ok. Status: ${response.status}`);
    }
    const responseData = await response.json();
    const validLinks = await Promise.all(
      responseData.images.map(async (image: any) => {
        const link = image.imageUrl;
        if (typeof link === 'string') {
          try {
            const imageResponse = await fetch(link, { method: 'HEAD' });
            if (imageResponse.ok) {
              const contentType = imageResponse.headers.get('content-type');
              if (contentType && contentType.startsWith('image/')) {
                return {
                  title: image.title,
                  link: link,
                };
              }
            }
          } catch (error) {
            console.error(`Error fetching image link ${link}:`, error);
          }
        }
        return null;
      })
    );
    const filteredLinks = validLinks.filter((link): link is { title: string; link: string } => link !== null);
    return filteredLinks.slice(0, 9);
  } catch (error) {
    console.error('Error fetching images:', error);
    throw error;
  }
}

export async function getVideos(message: string): Promise<{ imageUrl: string, link: string }[] | null> {
  const url = 'https://google.serper.dev/videos';
  const data = JSON.stringify({
    "q": message
  });
  const requestOptions: RequestInit = {
    method: 'POST',
    headers: {
      'X-API-KEY': process.env.SERPER_API as string,
      'Content-Type': 'application/json'
    },
    body: data
  };
  try {
    const response = await fetch(url, requestOptions);
    if (!response.ok) {
      throw new Error(`Network response was not ok. Status: ${response.status}`);
    }
    const responseData = await response.json();
    const validLinks = await Promise.all(
      responseData.videos.map(async (video: any) => {
        const imageUrl = video.imageUrl;
        if (typeof imageUrl === 'string') {
          try {
            const imageResponse = await fetch(imageUrl, { method: 'HEAD' });
            if (imageResponse.ok) {
              const contentType = imageResponse.headers.get('content-type');
              if (contentType && contentType.startsWith('image/')) {
                return { imageUrl, link: video.link };
              }
            }
          } catch (error) {
            console.error(`Error fetching image link ${imageUrl}:`, error);
          }
        }
        return null;
      })
    );
    const filteredLinks = validLinks.filter((link): link is { imageUrl: string, link: string } => link !== null);
    return filteredLinks.slice(0, 9);
  } catch (error) {
    console.error('Error fetching videos:', error);
    throw error;
  }
}

async function generateFollowUpQuestions(userMessage: string, sources: SearchResult[]): Promise<string[]> {
  const response = await axios.post('http://localhost:5000/process-followup-questions-message', {
    query: userMessage,
    sources: JSON.stringify(sources)
  });
  return response.data.followUp;
}

async function myAction(userMessage: string, category: string): Promise<any> {
  "use server";
  const streamable = createStreamableValue({});
  (async () => {
    const [sources, images, videos] = await Promise.all([
      getSources(userMessage),
      getImages(userMessage),
      getVideos(userMessage)
    ]);
    streamable.update({ 'searchResults': sources });
    streamable.update({ 'images': images });
    streamable.update({ 'videos': videos });

    const html = await get10BlueLinksContents(sources);
    const vectorResults = await processAndVectorizeContent(html, userMessage);
    const systemMessage = await axios.post('http://localhost:5000/process-query', { query: userMessage, category });
    const userMessageOptimized = await axios.post('http://localhost:5000/process-user-message', { results: JSON.stringify(vectorResults) });

    const chatCompletion = await openai.chat.completions.create({
      messages: [
        { role: "system", content: systemMessage.data.message },
        { role: "user", content: userMessageOptimized.data.user_message },
      ], stream: true, model: config.inferenceModel
    });

    for await (const chunk of chatCompletion) {
      if (chunk.choices[0].delta && chunk.choices[0].finish_reason !== "stop") {
        streamable.update({ 'llmResponse': chunk.choices[0].delta.content });
      } else if (chunk.choices[0].finish_reason === "stop") {
        streamable.update({ 'llmResponseEnd': true });
      }
    }

    const followUp = await generateFollowUpQuestions(userMessage, sources);
    streamable.update({ 'followUp': followUp });
    streamable.done({ status: 'done' });
  })();
  return streamable.value;
}

const initialAIState: {
  role: 'user' | 'assistant' | 'system' | 'function';
  content: string;
  id?: string;
  name?: string;
}[] = [];

const initialUIState: {
  id: number;
  display: React.ReactNode;
}[] = [];

export const AI = createAI({
  actions: {
    myAction
  },
  initialUIState,
  initialAIState,
});
