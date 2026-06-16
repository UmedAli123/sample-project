import os
import re
import json
import hashlib
import logging
from datetime import datetime
import xml.etree.ElementTree as ET
import requests
from bs4 import BeautifulSoup
from flask import Flask, render_template, jsonify, request

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)

FEED_URL = "https://docs.cloud.google.com/feeds/bigquery-release-notes.xml"
CACHE_FILE = "release_notes_cache.json"

# Helper function to parse dates
def parse_date(date_str):
    """
    Parses a date string like 'June 15, 2026' or ISO format and returns ISO date format YYYY-MM-DD
    """
    try:
        # If it is ISO format, parse it
        if 'T' in date_str:
            iso_date = date_str.split('T')[0]
            return iso_date
        
        # Else parse text format 'June 15, 2026'
        dt = datetime.strptime(date_str, "%B %d, %Y")
        return dt.strftime("%Y-%m-%d")
    except Exception as e:
        logger.warning(f"Failed to parse date: {date_str}. Error: {e}")
        # Return current date as fallback or empty
        return datetime.now().strftime("%Y-%m-%d")

def fetch_and_parse_feed(force_refresh=False):
    """
    Fetches the feed from Google Cloud, parses it into granular update items, and caches the result.
    If force_refresh is False and cache is valid, returns cached data.
    """
    # Try reading from cache first if not forcing refresh
    if not force_refresh and os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, 'r', encoding='utf-8') as f:
                cached_data = json.load(f)
                # Verify cache is list
                if isinstance(cached_data, dict) and "items" in cached_data:
                    logger.info("Serving release notes from cache.")
                    return cached_data
        except Exception as e:
            logger.error(f"Error reading cache file: {e}")

    # Fetch fresh data
    logger.info(f"Fetching fresh feed from {FEED_URL}...")
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
        }
        response = requests.get(FEED_URL, headers=headers, timeout=15)
        response.raise_for_status()
        xml_content = response.content
    except Exception as e:
        logger.error(f"Failed to fetch feed: {e}")
        # Fallback to cache if available
        if os.path.exists(CACHE_FILE):
            try:
                with open(CACHE_FILE, 'r', encoding='utf-8') as f:
                    logger.warning("Network request failed. Falling back to cached data.")
                    cached_data = json.load(f)
                    cached_data["fallback"] = True
                    cached_data["error_message"] = str(e)
                    return cached_data
            except:
                pass
        return {"error": True, "message": f"Failed to fetch feed: {str(e)}", "items": []}

    # Parse XML
    try:
        root = ET.fromstring(xml_content)
        # Atom feeds use xmlns="http://www.w3.org/2005/Atom"
        # We need to map this default namespace
        namespaces = {'ns': 'http://www.w3.org/2005/Atom'}
        
        feed_title = root.find('ns:title', namespaces)
        feed_title_text = feed_title.text if feed_title is not None else "BigQuery Release Notes"
        
        feed_updated = root.find('ns:updated', namespaces)
        feed_updated_text = feed_updated.text if feed_updated is not None else ""
        
        entries = root.findall('ns:entry', namespaces)
        parsed_items = []
        
        for entry in entries:
            # Entry title is typically the publication date (e.g. 'June 15, 2026')
            entry_title = entry.find('ns:title', namespaces)
            date_str = entry_title.text.strip() if entry_title is not None else ""
            
            entry_updated = entry.find('ns:updated', namespaces)
            updated_str = entry_updated.text.strip() if entry_updated is not None else ""
            
            date_iso = parse_date(date_str if date_str else updated_str)
            
            # Link to the release notes
            link_elem = entry.find('ns:link[@rel="alternate"]', namespaces)
            link = link_elem.get('href') if link_elem is not None else "https://cloud.google.com/bigquery/docs/release-notes"
            
            # HTML Content
            content_elem = entry.find('ns:content', namespaces)
            if content_elem is None or not content_elem.text:
                continue
                
            content_html = content_elem.text
            
            # Parse the content HTML to separate the specific updates
            soup = BeautifulSoup(content_html, 'html.parser')
            
            # Look for <h3> headings, which mark the start of each individual release note category
            headings = soup.find_all('h3')
            
            if not headings:
                # If there are no <h3> headings, treat the entire content as a single update
                text_content = soup.get_text().strip()
                item_id = hashlib.md5(f"{date_iso}-General-{text_content[:60]}".encode('utf-8')).hexdigest()
                parsed_items.append({
                    "id": item_id,
                    "date_str": date_str,
                    "date_iso": date_iso,
                    "type": "Update",
                    "html": str(soup),
                    "text": text_content,
                    "link": link
                })
                continue
                
            # Iterate through each <h3> heading and extract its associated paragraph/list elements
            for heading in headings:
                update_type = heading.get_text().strip() # e.g. "Feature", "Change", "Issue", "Deprecation"
                
                # Skip deprecation items
                if update_type.lower() in ('deprecation', 'deprecations', 'deprecated'):
                    continue
                
                # Collect sibling elements until the next h3
                siblings = []
                for sibling in heading.next_siblings:
                    if sibling.name == 'h3':
                        break
                    # Keep only tags or non-empty navigable strings
                    if sibling.name or (isinstance(sibling, str) and sibling.strip()):
                        siblings.append(sibling)
                
                # Build HTML and text representation
                item_html_parts = []
                for sib in siblings:
                    item_html_parts.append(str(sib))
                
                item_html = "".join(item_html_parts).strip()
                
                # Parse text representation for search and tweeting
                sibling_soup = BeautifulSoup(item_html, 'html.parser')
                item_text = sibling_soup.get_text().strip()
                
                # Generate unique ID based on date, type, and content snippet
                snippet = item_text[:100]
                hash_input = f"{date_iso}-{update_type}-{snippet}".encode('utf-8')
                item_id = hashlib.md5(hash_input).hexdigest()
                
                parsed_items.append({
                    "id": item_id,
                    "date_str": date_str,
                    "date_iso": date_iso,
                    "type": update_type,
                    "html": item_html,
                    "text": item_text,
                    "link": link
                })
        
        # Sort items by date (descending)
        parsed_items.sort(key=lambda x: x['date_iso'], reverse=True)
        
        result = {
            "title": feed_title_text,
            "last_fetched": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "feed_updated": feed_updated_text,
            "items": parsed_items,
            "error": False
        }
        
        # Save to cache
        try:
            with open(CACHE_FILE, 'w', encoding='utf-8') as f:
                json.dump(result, f, ensure_ascii=False, indent=2)
            logger.info("Saved fresh release notes to cache.")
        except Exception as e:
            logger.error(f"Failed to write cache: {e}")
            
        return result
        
    except Exception as e:
        logger.error(f"Error parsing XML content: {e}")
        return {"error": True, "message": f"Error parsing XML: {str(e)}", "items": []}

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/release-notes')
def get_release_notes():
    force_refresh = request.args.get('refresh', 'false').lower() == 'true'
    result = fetch_and_parse_feed(force_refresh=force_refresh)
    return jsonify(result)

@app.route('/api/tweet-mock', methods=['POST'])
def mock_tweet():
    """
    Mock endpoint to simulate posting a tweet.
    Can be used for demonstrating backend integration if needed.
    """
    data = request.json or {}
    tweet_text = data.get('text', '')
    item_id = data.get('item_id', '')
    
    if not tweet_text:
        return jsonify({"success": False, "message": "Tweet text is required"}), 400
        
    logger.info(f"Simulating tweet for item {item_id}: {tweet_text}")
    return jsonify({
        "success": True, 
        "message": "Mock tweet posted successfully!",
        "tweet": tweet_text,
        "timestamp": datetime.now().isoformat()
    })

if __name__ == '__main__':
    # Make sure cache is populated on startup
    fetch_and_parse_feed()
    app.run(host='0.0.0.0', port=5001, debug=True)
