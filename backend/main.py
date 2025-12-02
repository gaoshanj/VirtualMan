from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
import os
import requests
from dotenv import load_dotenv
import logging
from fastapi.staticfiles import StaticFiles

load_dotenv()

# logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Azure OpenAI Configuration
AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT")
AZURE_OPENAI_KEY = os.getenv("AZURE_OPENAI_KEY")
AZURE_OPENAI_DEPLOYMENT = os.getenv("AZURE_OPENAI_DEPLOYMENT")

# Azure Speech Configuration (for Avatar)
AZURE_SPEECH_ENDPOINT = os.getenv("AZURE_SPEECH_ENDPOINT")
AZURE_SPEECH_KEY = os.getenv("AZURE_SPEECH_KEY")
AZURE_SPEECH_REGION = os.getenv("AZURE_SPEECH_REGION")
AZURE_SPEECH_AVATAR = os.getenv("AZURE_SPEECH_AVATAR")
AZURE_SPEECH_AVATAR_STYLE = os.getenv("AZURE_SPEECH_AVATAR_STYLE")
AZURE_SPEECH_VOICE = os.getenv("AZURE_SPEECH_VOICE")

class AskRequest(BaseModel):
    question: str


app = FastAPI(title="VirtualMan Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/avatar/token")
def get_avatar_token(region: str = None):
    """Get avatar relay token from Azure Speech service"""
    if not AZURE_SPEECH_KEY:
        raise HTTPException(status_code=500, detail="Missing Azure Speech key.")
    
    use_region = region or AZURE_SPEECH_REGION
    token_url = f"https://{use_region}.tts.speech.microsoft.com/cognitiveservices/avatar/relay/token/v1"
    
    try:
        headers = {"Ocp-Apim-Subscription-Key": AZURE_SPEECH_KEY}
        logger.info('Requesting avatar relay token: %s (region=%s)', token_url, use_region)
        r = requests.get(token_url, headers=headers, timeout=10)
        logger.info('Avatar token endpoint responded: %s', r.status_code)
        try:
            r.raise_for_status()
        except Exception as ex:
            # Try to capture response body for debugging
            body = None
            try:
                body = r.text
            except Exception:
                body = '<unable to read response body>'
            logger.error('Avatar token request failed: %s; response body: %s', ex, body)
            raise
        # Parse JSON, but be defensive
        try:
            data = r.json()
        except Exception:
            # Log raw text and then re-raise
            logger.warning('Avatar token response not valid JSON, returning raw text')
            data_text = r.text
            return {"raw": data_text}
        # Also request a short-lived authorization token for Speech SDK usage
        try:
            sts_url = f"https://{use_region}.api.cognitive.microsoft.com/sts/v1.0/issueToken"
            logger.info('Requesting STS auth token: %s', sts_url)
            t = requests.post(sts_url, headers={"Ocp-Apim-Subscription-Key": AZURE_SPEECH_KEY}, timeout=10)
            logger.info('STS endpoint responded: %s', t.status_code)
            try:
                t.raise_for_status()
            except Exception as ex:
                body = None
                try:
                    body = t.text
                except Exception:
                    body = '<unable to read response body>'
                logger.error('STS token request failed: %s; response body: %s', ex, body)
                raise
            auth_token = t.text
            data["authToken"] = auth_token
        except Exception:
            # If auth token request fails, continue returning the relay token data
            logger.warning('Failed to acquire STS auth token; continuing with relay token only')
        return data
    except Exception as e:
        # Provide useful debug info while avoiding leaking secret keys
        logger.exception('Failed to get avatar token')
        raise HTTPException(status_code=500, detail=f"Failed to get avatar token: {str(e)}")


@app.get("/config")
def get_config():
    """Get frontend configuration"""
    return {
        "azureSpeech": {
            "region": AZURE_SPEECH_REGION,
            "hasKey": bool(AZURE_SPEECH_KEY)
        },
        "avatar": {
            "character": AZURE_SPEECH_AVATAR or "Meg",
            "style": AZURE_SPEECH_AVATAR_STYLE or "business",
            "voice": AZURE_SPEECH_VOICE or "zh-CN-Yunyi"
        }
    }


@app.get("/health")
def health_check():
    """Simple health check for load balancers / App Service."""
    return {"status": "ok"}


# NOTE: Static files mount moved to end of file (after API route declarations)


@app.post("/ask")
def ask(req: AskRequest):
    if not (AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_KEY and AZURE_OPENAI_DEPLOYMENT):
        raise HTTPException(status_code=500, detail="Missing Azure OpenAI environment variables. See README.")

    # Call Azure OpenAI (chat completion)
    openai_url = f"{AZURE_OPENAI_ENDPOINT}/openai/deployments/{AZURE_OPENAI_DEPLOYMENT}/chat/completions?api-version=2025-01-01-preview"
    headers = {"Content-Type": "application/json", "api-key": AZURE_OPENAI_KEY}
    payload = {"messages": [{"role": "system", "content": [{"type":"text","text":"你是一个微软认证培训师。你只能使用不超过100个字来回复学员的信息。"}]},{"role": "user", "content": req.question}]}

    try:
        r = requests.post(openai_url, headers=headers, json=payload, timeout=30)
        r.raise_for_status()
        jr = r.json()
        answer = None
        if isinstance(jr, dict):
            if "choices" in jr and jr["choices"]:
                choice = jr["choices"][0]
                if isinstance(choice, dict) and "message" in choice:
                    answer = choice["message"].get("content")
            if not answer:
                answer = jr.get("answer") or jr.get("content")
        if not answer:
            answer = "(no answer returned from OpenAI)"
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OpenAI request failed: {e}")

    return {"answer": answer}


# 尝试挂载 frontend 目录作为静态站点（当部署包包含 frontend 文件时）
try:
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)
    BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    FRONTEND_DIR = os.path.join(BASE_DIR, 'frontend')
    if os.path.exists(FRONTEND_DIR):
        # 将静态文件挂载到根路径。因为 API 路由已经声明过了，API 请求会优先匹配。
        app.mount('/', StaticFiles(directory=FRONTEND_DIR, html=True), name='frontend')
        logger.info('Mounted frontend static files from %s', FRONTEND_DIR)
    else:
        logger.info('Frontend directory not found at %s; skipping static mount', FRONTEND_DIR)
except Exception as e:
    # 不要因为挂载失败阻止应用启动
    try:
        logger
    except Exception:
        pass
    print('Warning: failed to mount frontend static files:', e)
