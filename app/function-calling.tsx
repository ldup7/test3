// @ts-nocheck
import { OpenAI } from 'openai';
import { config } from './config';
import axios from 'axios';

const client = new OpenAI({
    baseURL: config.nonOllamaBaseURL,
    apiKey: config.inferenceAPIKey
});

const MODEL = config.inferenceModel;


//Part 2: Define Functions for Place Search, Shopping, and Ticker Retrieval
export async function searchPlaces(query: string, location: string) {
    try {
        const response = await fetch('https://google.serper.dev/places', {
            method: 'POST',
            headers: {
                'X-API-KEY': process.env.SERPER_API,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ q: query, location: location }),
        });
        const data = await response.json();
        const normalizedData = {
            type: 'places',
            places: data.places.map(place => ({
                position: place.position,
                title: place.title,
                address: place.address,
                latitude: place.latitude,
                longitude: place.longitude,
                rating: place.rating,
                ratingCount: place.ratingCount,
                category: place.category,
                phoneNumber: place.phoneNumber,
                website: place.website,
                cid: place.cid
            }))
        };
        return JSON.stringify(normalizedData);
    } catch (error) {
        console.error('Error searching for places:', error);
        return JSON.stringify({ error: 'Failed to search for places' });
    }
}

export async function goShopping(message: string) {
    const url = 'https://google.serper.dev/shopping';
    const requestOptions: RequestInit = {
        method: 'POST',
        headers: {
            'X-API-KEY': process.env.SERPER_API as string,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ "q": message })
    };
    try {
        const response = await fetch(url, requestOptions);
        if (!response.ok) {
            throw new Error(`Network response was not ok. Status: ${response.status}`);
        }
        const responseData = await response.json();
        const shoppingData = {
            type: 'shopping',
            shopping: responseData.shopping
        };
        return JSON.stringify(shoppingData);
    } catch (error) {
        console.error('Error fetching shopping data:', error);
        throw error;
    }
}

export async function getTickers(ticker: string) {
    return JSON.stringify({ type: 'ticker', data: ticker });
}

//Part 3: Main Function Calling Logic
export async function functionCalling(query: string) {
    try {
        const systemResponse = await axios.post('http://localhost:5000/process-system-message', { query });
        const systemMessage = systemResponse.data.system_message;

        const messages = [
            { role: "system", content: systemMessage },
            { role: "user", content: query },
        ];

        const tools = [
            {
                type: "function",
                function: {
                    name: "getTickers",
                    description: "Get a single market name and stock ticker if the user mentions a public company",
                    parameters: {
                        type: "object",
                        properties: {
                            ticker: {
                                type: "string",
                                description: "The stock ticker symbol and market name, example NYSE:K or NASDAQ:AAPL",
                            },
                        },
                        required: ["ticker"],
                    },
                },
            },
            {
                type: "function",
                function: {
                    name: "searchPlaces",
                    description: "ONLY SEARCH for places using the given query and location",
                    parameters: {
                        type: "object",
                        properties: {
                            query: {
                                type: "string",
                                description: "The search query for places",
                            },
                            location: {
                                type: "string",
                                description: "The location to search for places",
                            },
                        },
                        required: ["query", "location"],
                    },
                },
            },
            {
                type: "function",
                function: {
                    name: "goShopping",
                    description: "Search for shopping items using the given query",
                    parameters: {
                        type: "object",
                        properties: {
                            query: {
                                type: "string",
                                description: "The search query for shopping items",
                            },
                        },
                        required: ["query"],
                    },
                }
            }
        ];

        const completionResponse = await client.chat.completions.create({
            model: MODEL,
            messages: messages,
            tools: tools,
            tool_choice: "auto",
            max_tokens: 4096,
        });

        const responseMessage = completionResponse.choices[0].message;
        const toolCalls = responseMessage.tool_calls;
        if (toolCalls) {
            const availableFunctions = {
                getTickers: getTickers,
                searchPlaces: searchPlaces,
                goShopping: goShopping,
            };
            for (const toolCall of toolCalls) {
                const functionName = toolCall.function.name;
                const functionToCall = availableFunctions[functionName];
                const functionArgs = JSON.parse(toolCall.function.arguments);
                let functionResponse;
                try {
                    if (functionName === 'getTickers') {
                        functionResponse = await functionToCall(functionArgs.ticker);
                    } else if (functionName === 'searchPlaces') {
                        functionResponse = await functionToCall(functionArgs.query, functionArgs.location);
                    } else if (functionName === 'goShopping') {
                        functionResponse = await functionToCall(functionArgs.query);
                    }
                    return JSON.parse(functionResponse);
                } catch (error) {
                    console.error(`Error calling function ${functionName}:`, error);
                    return JSON.stringify({ error: `Failed to call function ${functionName}` });
                }
            }
        }
    } catch (error) {
        console.error('Error in functionCalling:', error);
        return JSON.stringify({ error: 'An error occurred during function calling' });
    }
}

//
