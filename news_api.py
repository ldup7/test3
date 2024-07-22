import requests
from datetime import datetime, timedelta
import os
import json
import time

CACHE_FILE = "news_cache.json"
CACHE_TTL = 3600  # Cache time-to-live in seconds (e.g., 1 hour)

def load_cache():
    if os.path.exists(CACHE_FILE):
        with open(CACHE_FILE, "r") as file:
            try:
                return json.load(file)
            except json.JSONDecodeError:
                return {}
    return {}

def save_cache(cache):
    with open(CACHE_FILE, "w") as file:
        json.dump(cache, file)

def get_real_time_news(query, max_articles=5):
    cache = load_cache()
    current_time = datetime.utcnow().timestamp()

    if query in cache and isinstance(cache[query], list):
        cache[query] = {"timestamp": 0, "articles": cache[query]}

    if query in cache and current_time - cache[query]["timestamp"] < CACHE_TTL:
        print("Fetching data from cache")
        cached_articles = cache[query]["articles"]
        if cached_articles:
            return cached_articles[:max_articles]
        else:
            print("Cache is empty for this query")
    
    def fetch_news(from_date=None):
        url = 'https://newsapi.org/v2/everything'
        params = {
            'q': query,
            'sortBy': 'publishedAt',
            'language': 'fr',
            'apiKey': os.getenv('NEWS_API_KEY'),
            'pageSize': 100
        }
        if from_date:
            params['from'] = from_date
        
        print(f"Fetching news with params: {params}")
        response = requests.get(url, params=params)
        
        if response.status_code != 200:
            print(f"Error fetching news: {response.status_code}, {response.text}")
            if response.status_code == 429:
                retry_after = int(response.headers.get("Retry-After", 60))
                print(f"Retrying after {retry_after} seconds")
                time.sleep(retry_after)
                return fetch_news(from_date)
            if response.status_code == 426:
                print("Reached the limit for free plan's date range")
                return None
            return None
        
        return response.json()

    articles = []
    
    for days in range(7, 31, 7):
        from_date = (datetime.utcnow() - timedelta(days=days)).strftime('%Y-%m-%d')
        news_response = fetch_news(from_date)
        if news_response is None:
            continue
        new_articles = news_response.get('articles', [])
        articles.extend(new_articles)
        if len(articles) >= max_articles:
            break

    # Remove duplicates based on title and ensure relevance by filtering out irrelevant articles
    unique_articles = list({article['title']: article for article in articles}.values())
    query_keywords = query.lower().split()
    relevant_articles = [
        article for article in unique_articles
        if all(keyword in (article['title'] + " " + article['description']).lower() for keyword in query_keywords)
    ]
    sorted_articles = sorted(relevant_articles, key=lambda x: x['publishedAt'], reverse=True)[:max_articles]

    if sorted_articles:
        cache[query] = {
            "timestamp": current_time,
            "articles": sorted_articles
        }
        save_cache(cache)
    else:
        print("No relevant articles found from API")

    return sorted_articles

