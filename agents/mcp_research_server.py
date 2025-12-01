# -*- coding: utf-8 -*-
"""
Research Assistant MCP Server (FastMCP)

A real MCP server for academic research using FastMCP framework.

Install dependencies:
    pip install fastmcp requests beautifulsoup4 feedparser

Run (stdio mode for Claude Desktop, etc.):
    python mcp_research_server.py

Run (SSE mode for HTTP access):
    python mcp_research_server.py --transport sse --port 3001

Run with API keys (loads from mcp_api_keys.json):
    python mcp_research_server.py --transport sse --port 3001 --auth

Generate new API keys:
    python mcp_research_server.py --generate-keys 3
"""

import re
import time
import json
import argparse
import secrets
import string
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, List
from urllib.parse import quote_plus

import requests

# =============================================================================
# API Key Management
# =============================================================================

API_KEYS_FILE = Path(__file__).parent / "mcp_api_keys.json"


def generate_api_key(prefix: str = "mcp") -> str:
    """Generate a random API key."""
    random_part = ''.join(secrets.choice(string.ascii_letters + string.digits) for _ in range(32))
    return f"{prefix}_{random_part}"


def load_api_keys() -> Dict[str, dict]:
    """Load API keys from JSON file."""
    if not API_KEYS_FILE.exists():
        return {}
    try:
        with open(API_KEYS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return data.get("keys", {})
    except Exception as e:
        print(f"[Auth] Error loading API keys: {e}")
        return {}


def save_api_keys(keys: Dict[str, dict]):
    """Save API keys to JSON file."""
    data = {
        "description": "MCP Research Server API Keys",
        "updated_at": datetime.now().isoformat(),
        "keys": keys
    }
    with open(API_KEYS_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"[Auth] API keys saved to {API_KEYS_FILE}")


def generate_and_save_keys(count: int = 3) -> List[str]:
    """Generate new API keys and save to file."""
    keys = load_api_keys()
    new_keys = []

    for i in range(count):
        key = generate_api_key()
        keys[key] = {
            "name": f"key_{len(keys) + 1}",
            "created_at": datetime.now().isoformat(),
            "active": True
        }
        new_keys.append(key)

    save_api_keys(keys)
    return new_keys


def validate_api_key(key: str) -> bool:
    """Check if an API key is valid and active."""
    keys = load_api_keys()
    if key in keys:
        return keys[key].get("active", True)
    return False


# Global flag for auth requirement
AUTH_ENABLED = False

try:
    from fastmcp import FastMCP
except ImportError:
    print("FastMCP not installed. Run: pip install fastmcp")
    exit(1)

# Create MCP server
mcp = FastMCP("Research Assistant")

# Configuration
REQUEST_TIMEOUT = 15
last_request_time = {}
MIN_REQUEST_INTERVAL = 1.0


def rate_limit(api_name: str):
    """Simple rate limiting for external API calls."""
    global last_request_time
    now = time.time()
    if api_name in last_request_time:
        elapsed = now - last_request_time[api_name]
        if elapsed < MIN_REQUEST_INTERVAL:
            time.sleep(MIN_REQUEST_INTERVAL - elapsed)
    last_request_time[api_name] = time.time()


# =============================================================================
# Research Tools
# =============================================================================

@mcp.tool()
def search_papers(
    query: str,
    limit: int = 5,
    year_from: Optional[int] = None
) -> str:
    """
    Search for academic papers using Semantic Scholar.

    Args:
        query: Search query (e.g., 'transformer attention mechanism')
        limit: Maximum number of results (default: 5, max: 10)
        year_from: Filter papers from this year onwards (e.g., 2020)

    Returns:
        JSON string with paper titles, authors, abstracts, and citation counts
    """
    rate_limit('semantic_scholar')
    limit = min(limit, 10)

    fields = "paperId,title,authors,year,abstract,citationCount,url,venue,openAccessPdf"
    url = "https://api.semanticscholar.org/graph/v1/paper/search"
    params = {"query": query, "limit": limit, "fields": fields}
    if year_from:
        params["year"] = f"{year_from}-"

    try:
        resp = requests.get(url, params=params, timeout=REQUEST_TIMEOUT)
        if resp.status_code == 200:
            data = resp.json()
            papers = []
            for paper in data.get("data", []):
                abstract = paper.get("abstract") or ""
                papers.append({
                    "id": paper.get("paperId"),
                    "title": paper.get("title"),
                    "authors": [a.get("name") for a in paper.get("authors", [])[:5]],
                    "year": paper.get("year"),
                    "abstract": abstract[:400] + "..." if len(abstract) > 400 else abstract,
                    "citations": paper.get("citationCount"),
                    "venue": paper.get("venue"),
                    "url": paper.get("url"),
                    "pdf": paper.get("openAccessPdf", {}).get("url") if paper.get("openAccessPdf") else None
                })
            return json.dumps({"papers": papers, "total": data.get("total", len(papers))}, ensure_ascii=False, indent=2)
        return json.dumps({"error": f"API error: {resp.status_code}"})
    except Exception as e:
        return json.dumps({"error": str(e)})


@mcp.tool()
def search_arxiv(
    query: str,
    category: Optional[str] = None,
    limit: int = 5
) -> str:
    """
    Search arXiv for preprints and papers. Good for recent ML/AI/CS/Physics research.

    Args:
        query: Search query for arXiv
        category: arXiv category filter (e.g., 'cs.CL', 'cs.LG', 'cs.AI', 'stat.ML')
        limit: Maximum number of results (default: 5, max: 10)

    Returns:
        JSON string with arXiv papers including titles, authors, abstracts
    """
    rate_limit('arxiv')

    try:
        import feedparser
    except ImportError:
        return json.dumps({"error": "feedparser not installed. Run: pip install feedparser"})

    limit = min(limit, 10)
    search_query = quote_plus(query)
    if category:
        search_query = f"cat:{category}+AND+all:{search_query}"

    url = f"http://export.arxiv.org/api/query?search_query=all:{search_query}&start=0&max_results={limit}&sortBy=relevance"

    try:
        feed = feedparser.parse(url)
        papers = []
        for entry in feed.entries:
            arxiv_id = entry.id.split('/abs/')[-1]
            summary = entry.summary.replace('\n', ' ')
            papers.append({
                "id": arxiv_id,
                "title": entry.title.replace('\n', ' '),
                "authors": [a.name for a in entry.authors[:5]],
                "published": entry.published[:10],
                "abstract": summary[:400] + "..." if len(summary) > 400 else summary,
                "categories": [t.term for t in entry.tags],
                "url": entry.link,
                "pdf": entry.link.replace('/abs/', '/pdf/') + ".pdf"
            })
        return json.dumps({"papers": papers}, ensure_ascii=False, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


@mcp.tool()
def get_paper_details(paper_id: str) -> str:
    """
    Get detailed information about a specific paper.

    Args:
        paper_id: Paper identifier - Semantic Scholar ID, arXiv ID (e.g., '2103.14030'), or DOI

    Returns:
        JSON string with full paper details including abstract, citations, references
    """
    rate_limit('semantic_scholar')

    # Determine ID type
    if paper_id.startswith("10."):
        lookup_id = f"DOI:{paper_id}"
    elif re.match(r"^\d{4}\.\d{4,5}(v\d+)?$", paper_id):
        lookup_id = f"ARXIV:{paper_id}"
    else:
        lookup_id = paper_id

    fields = "paperId,title,authors,year,abstract,citationCount,referenceCount,venue,url,openAccessPdf,tldr,fieldsOfStudy"
    url = f"https://api.semanticscholar.org/graph/v1/paper/{lookup_id}?fields={fields}"

    try:
        resp = requests.get(url, timeout=REQUEST_TIMEOUT)
        if resp.status_code == 200:
            paper = resp.json()
            result = {
                "id": paper.get("paperId"),
                "title": paper.get("title"),
                "authors": [a.get("name") for a in paper.get("authors", [])],
                "year": paper.get("year"),
                "abstract": paper.get("abstract"),
                "tldr": paper.get("tldr", {}).get("text") if paper.get("tldr") else None,
                "citations": paper.get("citationCount"),
                "references": paper.get("referenceCount"),
                "venue": paper.get("venue"),
                "fields": paper.get("fieldsOfStudy"),
                "url": paper.get("url"),
                "pdf": paper.get("openAccessPdf", {}).get("url") if paper.get("openAccessPdf") else None
            }
            return json.dumps(result, ensure_ascii=False, indent=2)
        elif resp.status_code == 404:
            return json.dumps({"error": "Paper not found"})
        return json.dumps({"error": f"API error: {resp.status_code}"})
    except Exception as e:
        return json.dumps({"error": str(e)})


@mcp.tool()
def find_similar_papers(paper_id: str, limit: int = 5) -> str:
    """
    Find papers similar to a given paper. Useful for literature review.

    Args:
        paper_id: Paper identifier to find similar papers for
        limit: Maximum number of similar papers (default: 5)

    Returns:
        JSON string with list of similar papers
    """
    rate_limit('semantic_scholar')

    if paper_id.startswith("10."):
        lookup_id = f"DOI:{paper_id}"
    elif re.match(r"^\d{4}\.\d{4,5}(v\d+)?$", paper_id):
        lookup_id = f"ARXIV:{paper_id}"
    else:
        lookup_id = paper_id

    fields = "paperId,title,authors,year,citationCount,url"
    url = f"https://api.semanticscholar.org/recommendations/v1/papers/forpaper/{lookup_id}?fields={fields}&limit={min(limit, 10)}"

    try:
        resp = requests.get(url, timeout=REQUEST_TIMEOUT)
        if resp.status_code == 200:
            data = resp.json()
            papers = []
            for paper in data.get("recommendedPapers", []):
                papers.append({
                    "id": paper.get("paperId"),
                    "title": paper.get("title"),
                    "authors": [a.get("name") for a in paper.get("authors", [])[:3]],
                    "year": paper.get("year"),
                    "citations": paper.get("citationCount"),
                    "url": paper.get("url")
                })
            return json.dumps({"similar_papers": papers}, ensure_ascii=False, indent=2)
        return json.dumps({"error": f"API error: {resp.status_code}"})
    except Exception as e:
        return json.dumps({"error": str(e)})


@mcp.tool()
def get_citations(paper_id: str, limit: int = 5) -> str:
    """
    Get papers that cite a given paper. Useful for finding follow-up work.

    Args:
        paper_id: Paper identifier to get citations for
        limit: Maximum number of citing papers (default: 5)

    Returns:
        JSON string with list of papers that cite this paper
    """
    rate_limit('semantic_scholar')

    if paper_id.startswith("10."):
        lookup_id = f"DOI:{paper_id}"
    elif re.match(r"^\d{4}\.\d{4,5}(v\d+)?$", paper_id):
        lookup_id = f"ARXIV:{paper_id}"
    else:
        lookup_id = paper_id

    fields = "paperId,title,authors,year,citationCount,url"
    url = f"https://api.semanticscholar.org/graph/v1/paper/{lookup_id}/citations?fields={fields}&limit={min(limit, 10)}"

    try:
        resp = requests.get(url, timeout=REQUEST_TIMEOUT)
        if resp.status_code == 200:
            data = resp.json()
            papers = []
            for item in data.get("data", []):
                paper = item.get("citingPaper", {})
                papers.append({
                    "id": paper.get("paperId"),
                    "title": paper.get("title"),
                    "authors": [a.get("name") for a in paper.get("authors", [])[:3]],
                    "year": paper.get("year"),
                    "citations": paper.get("citationCount"),
                    "url": paper.get("url")
                })
            return json.dumps({"citing_papers": papers}, ensure_ascii=False, indent=2)
        return json.dumps({"error": f"API error: {resp.status_code}"})
    except Exception as e:
        return json.dumps({"error": str(e)})


@mcp.tool()
def get_references(paper_id: str, limit: int = 5) -> str:
    """
    Get papers referenced by a given paper. Useful for finding foundational work.

    Args:
        paper_id: Paper identifier to get references for
        limit: Maximum number of references (default: 5)

    Returns:
        JSON string with list of referenced papers
    """
    rate_limit('semantic_scholar')

    if paper_id.startswith("10."):
        lookup_id = f"DOI:{paper_id}"
    elif re.match(r"^\d{4}\.\d{4,5}(v\d+)?$", paper_id):
        lookup_id = f"ARXIV:{paper_id}"
    else:
        lookup_id = paper_id

    fields = "paperId,title,authors,year,citationCount,url"
    url = f"https://api.semanticscholar.org/graph/v1/paper/{lookup_id}/references?fields={fields}&limit={min(limit, 10)}"

    try:
        resp = requests.get(url, timeout=REQUEST_TIMEOUT)
        if resp.status_code == 200:
            data = resp.json()
            papers = []
            for item in data.get("data", []):
                paper = item.get("citedPaper", {})
                if paper.get("title"):
                    papers.append({
                        "id": paper.get("paperId"),
                        "title": paper.get("title"),
                        "authors": [a.get("name") for a in paper.get("authors", [])[:3]],
                        "year": paper.get("year"),
                        "citations": paper.get("citationCount"),
                        "url": paper.get("url")
                    })
            return json.dumps({"references": papers}, ensure_ascii=False, indent=2)
        return json.dumps({"error": f"API error: {resp.status_code}"})
    except Exception as e:
        return json.dumps({"error": str(e)})


@mcp.tool()
def search_author(name: str, limit: int = 5) -> str:
    """
    Search for an author and get their top publications.

    Args:
        name: Author name to search for
        limit: Maximum number of papers to return (default: 5)

    Returns:
        JSON string with author info and their top papers by citation count
    """
    rate_limit('semantic_scholar')

    url = f"https://api.semanticscholar.org/graph/v1/author/search?query={quote_plus(name)}&limit=1"

    try:
        resp = requests.get(url, timeout=REQUEST_TIMEOUT)
        if resp.status_code == 200:
            data = resp.json()
            if not data.get("data"):
                return json.dumps({"error": "Author not found"})

            author_id = data["data"][0]["authorId"]
            author_name = data["data"][0]["name"]

            papers_url = f"https://api.semanticscholar.org/graph/v1/author/{author_id}/papers?fields=title,year,citationCount,url&limit={min(limit * 2, 20)}"
            papers_resp = requests.get(papers_url, timeout=REQUEST_TIMEOUT)

            if papers_resp.status_code == 200:
                papers_data = papers_resp.json()
                papers = []
                for paper in papers_data.get("data", []):
                    papers.append({
                        "title": paper.get("title"),
                        "year": paper.get("year"),
                        "citations": paper.get("citationCount"),
                        "url": paper.get("url")
                    })
                papers.sort(key=lambda x: x.get("citations") or 0, reverse=True)
                return json.dumps({
                    "author": author_name,
                    "author_id": author_id,
                    "top_papers": papers[:limit]
                }, ensure_ascii=False, indent=2)
        return json.dumps({"error": f"API error: {resp.status_code}"})
    except Exception as e:
        return json.dumps({"error": str(e)})


@mcp.tool()
def fetch_webpage(url: str, max_length: int = 5000) -> str:
    """
    Fetch and extract main text content from a URL.

    Args:
        url: URL to fetch content from
        max_length: Maximum content length to return (default: 5000 chars)

    Returns:
        JSON string with page title and extracted text content
    """
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        return json.dumps({"error": "beautifulsoup4 not installed. Run: pip install beautifulsoup4"})

    try:
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        resp = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()

        soup = BeautifulSoup(resp.text, 'html.parser')
        for element in soup(['script', 'style', 'nav', 'footer', 'header', 'aside']):
            element.decompose()

        title = soup.title.string if soup.title else ""
        main_content = soup.find('main') or soup.find('article') or soup.find('div', class_=re.compile(r'content|article|post'))

        if main_content:
            text = main_content.get_text(separator='\n', strip=True)
        else:
            text = soup.get_text(separator='\n', strip=True)

        text = re.sub(r'\n\s*\n', '\n\n', text)[:max_length]

        return json.dumps({
            "title": title,
            "url": url,
            "content": text,
            "length": len(text)
        }, ensure_ascii=False, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


@mcp.tool()
def format_citation(paper_id: str, style: str = "apa") -> str:
    """
    Format a paper citation in various academic styles.

    Args:
        paper_id: Paper identifier to generate citation for
        style: Citation style - 'apa', 'mla', 'chicago', or 'bibtex' (default: 'apa')

    Returns:
        Formatted citation string
    """
    # Get paper details first
    details_json = get_paper_details(paper_id)
    paper = json.loads(details_json)

    if "error" in paper:
        return json.dumps(paper)

    title = paper.get("title", "Unknown Title")
    authors = paper.get("authors", [])
    year = paper.get("year", "n.d.")
    venue = paper.get("venue", "")

    style = style.lower()

    if style == "apa":
        if authors:
            if len(authors) == 1:
                author_str = authors[0]
            elif len(authors) == 2:
                author_str = f"{authors[0]} & {authors[1]}"
            else:
                author_str = f"{authors[0]} et al."
        else:
            author_str = "Unknown"
        citation = f"{author_str} ({year}). {title}."
        if venue:
            citation += f" {venue}."

    elif style == "mla":
        if authors:
            author_str = authors[0] + (" et al." if len(authors) > 1 else "")
        else:
            author_str = "Unknown"
        citation = f'{author_str}. "{title}."'
        if venue:
            citation += f" {venue},"
        citation += f" {year}."

    elif style == "chicago":
        if authors:
            author_str = ", ".join(authors[:3]) + (" et al." if len(authors) > 3 else "")
        else:
            author_str = "Unknown"
        citation = f'{author_str}. "{title}."'
        if venue:
            citation += f" {venue}"
        citation += f" ({year})."

    elif style == "bibtex":
        first_author = authors[0].split()[-1].lower() if authors else "unknown"
        key = f"{first_author}{year}"
        author_bibtex = " and ".join(authors) if authors else "Unknown"
        citation = f"""@article{{{key},
  title = {{{title}}},
  author = {{{author_bibtex}}},
  year = {{{year}}},
  journal = {{{venue or 'Unknown'}}}
}}"""
    else:
        return json.dumps({"error": f"Unknown citation style: {style}"})

    return json.dumps({"citation": citation, "style": style.upper()}, ensure_ascii=False, indent=2)


# =============================================================================
# Main
# =============================================================================

def get_tool_definitions() -> list:
    """Get tool definitions in REST-compatible format."""
    return [
        {
            "name": "search_papers",
            "description": "Search for academic papers using Semantic Scholar.",
            "parameters": {
                "query": {"type": "string", "description": "Search query (e.g., 'transformer attention mechanism')", "required": True},
                "limit": {"type": "integer", "description": "Maximum number of results (default: 5, max: 10)", "required": False},
                "year_from": {"type": "integer", "description": "Filter papers from this year onwards", "required": False}
            }
        },
        {
            "name": "search_arxiv",
            "description": "Search arXiv for preprints and papers. Good for recent ML/AI/CS/Physics research.",
            "parameters": {
                "query": {"type": "string", "description": "Search query for arXiv", "required": True},
                "category": {"type": "string", "description": "arXiv category filter (e.g., 'cs.CL', 'cs.LG', 'cs.AI')", "required": False},
                "limit": {"type": "integer", "description": "Maximum number of results (default: 5, max: 10)", "required": False}
            }
        },
        {
            "name": "get_paper_details",
            "description": "Get detailed information about a specific paper.",
            "parameters": {
                "paper_id": {"type": "string", "description": "Paper identifier - Semantic Scholar ID, arXiv ID, or DOI", "required": True}
            }
        },
        {
            "name": "find_similar_papers",
            "description": "Find papers similar to a given paper. Useful for literature review.",
            "parameters": {
                "paper_id": {"type": "string", "description": "Paper identifier to find similar papers for", "required": True},
                "limit": {"type": "integer", "description": "Maximum number of similar papers (default: 5)", "required": False}
            }
        },
        {
            "name": "get_citations",
            "description": "Get papers that cite a given paper. Useful for finding follow-up work.",
            "parameters": {
                "paper_id": {"type": "string", "description": "Paper identifier to get citations for", "required": True},
                "limit": {"type": "integer", "description": "Maximum number of citing papers (default: 5)", "required": False}
            }
        },
        {
            "name": "get_references",
            "description": "Get papers referenced by a given paper. Useful for finding foundational work.",
            "parameters": {
                "paper_id": {"type": "string", "description": "Paper identifier to get references for", "required": True},
                "limit": {"type": "integer", "description": "Maximum number of references (default: 5)", "required": False}
            }
        },
        {
            "name": "search_author",
            "description": "Search for an author and get their top publications.",
            "parameters": {
                "name": {"type": "string", "description": "Author name to search for", "required": True},
                "limit": {"type": "integer", "description": "Maximum number of papers to return (default: 5)", "required": False}
            }
        },
        {
            "name": "fetch_webpage",
            "description": "Fetch and extract main text content from a URL.",
            "parameters": {
                "url": {"type": "string", "description": "URL to fetch content from", "required": True},
                "max_length": {"type": "integer", "description": "Maximum content length to return (default: 5000)", "required": False}
            }
        },
        {
            "name": "format_citation",
            "description": "Format a paper citation in various academic styles (apa, mla, chicago, bibtex).",
            "parameters": {
                "paper_id": {"type": "string", "description": "Paper identifier to generate citation for", "required": True},
                "style": {"type": "string", "description": "Citation style: 'apa', 'mla', 'chicago', or 'bibtex'", "required": False}
            }
        }
    ]


# Map tool names to functions
TOOL_FUNCTIONS = {}


def get_callable(func):
    """Get the actual callable from a function or FunctionTool."""
    # FunctionTool objects have a 'fn' attribute with the original function
    if hasattr(func, 'fn') and callable(func.fn):
        return func.fn
    # Or they might be directly callable
    if callable(func):
        return func
    raise ValueError(f"Cannot get callable from {type(func)}")


def register_tool_functions():
    """Register tool functions after they're defined."""
    global TOOL_FUNCTIONS
    # Get the actual callable functions (handling FastMCP's FunctionTool wrapper)
    TOOL_FUNCTIONS = {
        "search_papers": get_callable(search_papers),
        "search_arxiv": get_callable(search_arxiv),
        "get_paper_details": get_callable(get_paper_details),
        "find_similar_papers": get_callable(find_similar_papers),
        "get_citations": get_callable(get_citations),
        "get_references": get_callable(get_references),
        "search_author": get_callable(search_author),
        "fetch_webpage": get_callable(fetch_webpage),
        "format_citation": get_callable(format_citation)
    }


def run_with_auth(host: str, port: int, auth_enabled: bool = False):
    """Run MCP server with optional API key authentication via SSE + REST endpoints."""
    from starlette.applications import Starlette
    from starlette.middleware import Middleware
    from starlette.middleware.base import BaseHTTPMiddleware
    from starlette.responses import JSONResponse
    from starlette.routing import Route
    import uvicorn

    # Register tool functions
    register_tool_functions()

    class APIKeyMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next):
            # Skip auth for health check, root, and tools listing
            skip_paths = ["/", "/health", "/keys/list", "/tools/list", "/tools", "/api/tools"]
            if request.url.path in skip_paths:
                # Still check auth for tools/execute if auth enabled
                if request.url.path not in ["/tools/execute"] or not auth_enabled:
                    return await call_next(request)

            if auth_enabled:
                auth_header = request.headers.get("Authorization", "")
                provided_key = auth_header.replace("Bearer ", "") if auth_header.startswith("Bearer ") else auth_header

                if not provided_key:
                    provided_key = request.headers.get("X-API-Key", "")

                if not provided_key or not validate_api_key(provided_key):
                    return JSONResponse(
                        {"error": "Unauthorized", "message": "Invalid or missing API key"},
                        status_code=401
                    )

            return await call_next(request)

    # REST API endpoint handlers
    async def health(request):
        keys = load_api_keys()
        return JSONResponse({
            "status": "ok",
            "server": "Research Assistant MCP",
            "auth_enabled": auth_enabled,
            "active_keys": len([k for k, v in keys.items() if v.get("active", True)])
        })

    async def list_tools(request):
        """REST endpoint to list available tools - compatible with backend."""
        tools = get_tool_definitions()
        return JSONResponse({
            "tools": tools,
            "server": "Research Assistant MCP",
            "version": "1.0.0"
        })

    async def execute_tool(request):
        """REST endpoint to execute a tool - compatible with backend."""
        try:
            body = await request.json()

            # Debug logging
            print(f"[MCP Server] execute_tool received body: {body}")

            # Support multiple request formats:
            # 1. JSON-RPC: { jsonrpc: "2.0", params: { name: "tool", arguments: {} } }
            # 2. Simple: { tool: "name", arguments: {} }
            # 3. Alternative: { name: "tool", args: {} }

            if body.get("jsonrpc") and body.get("params"):
                # JSON-RPC format from backend
                params = body.get("params", {})
                tool_name = params.get("name")
                arguments = params.get("arguments") or {}
                print(f"[MCP Server] JSON-RPC format: tool={tool_name}, args={arguments}")
            else:
                # Simple format
                tool_name = body.get("tool") or body.get("name")
                arguments = body.get("arguments") or body.get("params") or body.get("args") or {}
                print(f"[MCP Server] Simple format: tool={tool_name}, args={arguments}")

            if not tool_name:
                print(f"[MCP Server] ERROR: Missing tool name in body: {body}")
                return JSONResponse({"error": "Missing tool name", "received_body": body}, status_code=400)

            if tool_name not in TOOL_FUNCTIONS:
                return JSONResponse({"error": f"Unknown tool: {tool_name}"}, status_code=404)

            # Execute the tool function
            func = TOOL_FUNCTIONS[tool_name]
            result = func(**arguments)

            # Parse result if it's JSON string
            try:
                parsed_result = json.loads(result) if isinstance(result, str) else result
            except json.JSONDecodeError:
                parsed_result = {"result": result}

            return JSONResponse({
                "success": True,
                "tool": tool_name,
                "result": parsed_result
            })
        except TypeError as e:
            return JSONResponse({
                "error": f"Invalid arguments: {str(e)}",
                "tool": tool_name
            }, status_code=400)
        except Exception as e:
            return JSONResponse({
                "error": str(e),
                "tool": tool_name if 'tool_name' in dir() else "unknown"
            }, status_code=500)

    # Define REST routes - accept both GET and POST for tools listing for maximum compatibility
    rest_routes = [
        Route("/health", health, methods=["GET"]),
        Route("/tools/list", list_tools, methods=["GET", "POST"]),
        Route("/tools", list_tools, methods=["GET", "POST"]),
        Route("/api/tools", list_tools, methods=["GET", "POST"]),
        Route("/tools/call", execute_tool, methods=["POST"]),       # MCP standard
        Route("/tools/execute", execute_tool, methods=["POST"]),
        Route("/api/tools/execute", execute_tool, methods=["POST"]),
        Route("/mcp/execute", execute_tool, methods=["POST"]),
        Route("/execute", execute_tool, methods=["POST"]),
    ]

    # Create main Starlette app with REST routes only
    # Note: FastMCP SSE transport is not mounted to avoid initialization errors
    # The backend uses REST endpoints which work reliably
    app = Starlette(
        routes=rest_routes,
        middleware=[Middleware(APIKeyMiddleware)]
    )

    print(f"[REST] Endpoints available:")
    print(f"  GET/POST /tools/list       - List available tools")
    print(f"  GET/POST /tools            - List available tools (alias)")
    print(f"  GET/POST /api/tools        - List available tools (alias)")
    print(f"  POST     /tools/call       - Execute a tool (MCP standard)")
    print(f"  POST     /tools/execute    - Execute a tool")
    print(f"  POST     /api/tools/execute - Execute a tool")
    print(f"  POST     /execute          - Execute a tool (alias)")
    print(f"  GET      /health           - Health check")

    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Research Assistant MCP Server')
    parser.add_argument('--transport', choices=['stdio', 'sse'], default='sse',
                        help='Transport mode: stdio (for Claude Desktop) or sse (for HTTP)')
    parser.add_argument('--port', type=int, default=3001, help='Port for SSE transport')
    parser.add_argument('--host', type=str, default='0.0.0.0', help='Host for SSE transport')
    parser.add_argument('--auth', action='store_true', help='Enable API key authentication')
    parser.add_argument('--generate-keys', type=int, metavar='N', help='Generate N new API keys and exit')
    parser.add_argument('--list-keys', action='store_true', help='List all API keys and exit')

    args = parser.parse_args()

    # Handle key generation
    if args.generate_keys:
        print("=" * 60)
        print("Generating API Keys")
        print("=" * 60)
        new_keys = generate_and_save_keys(args.generate_keys)
        print(f"\nGenerated {len(new_keys)} new API keys:\n")
        for key in new_keys:
            print(f"  {key}")
        print(f"\nKeys saved to: {API_KEYS_FILE}")
        print("=" * 60)
        exit(0)

    # Handle key listing
    if args.list_keys:
        print("=" * 60)
        print("API Keys")
        print("=" * 60)
        keys = load_api_keys()
        if not keys:
            print("\nNo API keys found. Generate with: --generate-keys N")
        else:
            print(f"\nFound {len(keys)} keys:\n")
            for key, info in keys.items():
                status = "✓ active" if info.get("active", True) else "✗ inactive"
                name = info.get("name", "unnamed")
                created = info.get("created_at", "unknown")[:10]
                print(f"  [{status}] {key[:20]}... ({name}, created: {created})")
        print(f"\nKeys file: {API_KEYS_FILE}")
        print("=" * 60)
        exit(0)

    print("=" * 60)
    print("Research Assistant MCP Server (FastMCP)")
    print("=" * 60)
    print(f"[Transport] {args.transport.upper()}")

    if args.transport == 'sse':
        print(f"[Server] http://{args.host}:{args.port}")

        if args.auth:
            keys = load_api_keys()
            if not keys:
                print("[Auth] WARNING: Auth enabled but no keys found!")
                print("[Auth] Generate keys with: --generate-keys 3")
                print("[Auth] Starting without authentication...")
                args.auth = False
            else:
                active_count = len([k for k, v in keys.items() if v.get("active", True)])
                print(f"[Auth] Enabled ({active_count} active keys)")
        else:
            print(f"[Auth] Disabled (open access)")

        print("=" * 60)
        print("[Tools]")
        tool_names = [
            "search_papers", "search_arxiv", "get_paper_details", "find_similar_papers",
            "get_citations", "get_references", "search_author", "fetch_webpage", "format_citation"
        ]
        for name in tool_names:
            print(f"  - {name}")
        print("=" * 60)

        # Run with custom auth wrapper
        run_with_auth(args.host, args.port, args.auth)
    else:
        print("[Mode] stdio - for Claude Desktop integration")
        print("=" * 60)
        mcp.run()
