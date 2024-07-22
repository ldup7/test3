import os
from news_api import get_real_time_news

if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

    api_key = os.getenv('NEWS_API_KEY')
    if not api_key:
        print("Error: NEWS_API_KEY environment variable is not set.")
    else:
        print(f"NEWS_API_KEY is set: {api_key}")

    query = "l'IA dans la france "
    
    print(f"Query: {query}")
    news = get_real_time_news(query)
    if news is None:
        print("Error fetching news. You may have hit the rate limit.")
    elif not news:
        print("No news articles found.")
    else:
        for article in news:
            print(f"Title: {article['title']}")
            print(f"Published At: {article['publishedAt']}")
            print(f"Description: {article['description']}\n")
    print("-" * 40)
