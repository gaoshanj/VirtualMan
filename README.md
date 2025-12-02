# VirtualMan — AI 虚拟人问答应用

一个集成 Azure Speech Avatar 实时虚拟人、Azure OpenAI GPT 和 WebRTC 的完整演示应用。

## 功能

- 🤖 **实时虚拟人** — 使用 Azure Speech Avatar WebRTC API 实时流媒体虚拟人视频
- 💬 **AI 问答** — 集成 Azure OpenAI 进行自然语言理解和生成
- 🎤 **文本转语音** — 虚拟人使用配置的声音讲话
- 📱 **响应式设计** — 适配桌面和平板设备

## 项目结构

```
VirtualMan/
├── backend/              # FastAPI 后端
│   ├── main.py          # 主应用（/ask, /avatar/token, /config 端点）
│   ├── requirements.txt  # Python 依赖
│   └── .env.example     # 环境变量模板
├── frontend/             # 静态前端
│   ├── index.html       # HTML UI
│   ├── app.js           # 实时虚拟人 WebRTC 客户端
│   └── styles.css       # 样式表
├── Sample/              # Azure 官方示例代码参考
└── README.md            # 本文件
```

## 前置要求

### Azure 资源

1. **Azure Speech 服务** — 需要启用虚拟人功能
   - 获取 API Key 和 Region（例如 `swedencentral`）
   
2. **Azure OpenAI 服务** — 部署 GPT 模型（例如 GPT-4 或 GPT-4o）
   - 获取 Endpoint、API Key 和 Deployment Name

### 本地环境

- Python 3.8+
- pip
- 浏览器（支持 WebRTC）

## 快速开始

### 1. 安装依赖

```powershell
# 创建虚拟环境
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# 安装 Python 依赖
pip install -r backend/requirements.txt
```

### 2. 配置 Azure 密钥

复制环境变量模板并填入实际的 Azure 密钥：

```powershell
cp backend\.env.example backend\.env
```

编辑 `backend\.env` 并填入：

```
# Azure OpenAI
AZURE_OPENAI_ENDPOINT=https://<your-openai-resource>.openai.azure.com/
AZURE_OPENAI_KEY=<your-openai-api-key>
AZURE_OPENAI_DEPLOYMENT=<your-gpt-deployment-name>

# Azure Speech (虚拟人)
AZURE_SPEECH_REGION=swedencentral
AZURE_SPEECH_KEY=<your-speech-api-key>
AZURE_SPEECH_AVATAR=lisa                    # 虚拟人角色 (lisa, jenny, 等)
AZURE_SPEECH_AVATAR_STYLE=casual-sitting    # 虚拟人风格
AZURE_SPEECH_VOICE=zh-CN-XiaoxiaoNeural     # TTS 声音
```

### 3. 启动后端

```powershell
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

后端将在 `http://localhost:8000` 启动。

### 4. 启动前端静态服务器

在新的 PowerShell 窗口：

```powershell
cd frontend
python -m http.server 3000
```

然后在浏览器中打开 `http://localhost:3000`

### 5. 使用应用

1. **配置资源**
   - 选择 Azure 语音资源地区（例如 `swedencentral`）
   - 输入 Speech API 密钥
   - 填入 Azure OpenAI 端点、API 密钥和部署名称

2. **开始对话**
   - 点击"开始对话"按钮以连接到虚拟人服务
   - 虚拟人视频会在右侧显示

3. **发送消息**
   - 在文本框中输入问题
   - 点击"发送"按钮
   - 后端调用 GPT 获取答案，虚拟人讲话并显示视频

## API 端点

### POST /ask
发送问题给 GPT 并获取回答。

**请求体：**
```json
{
  "question": "你好，今天天气怎么样？"
}
```

**响应：**
```json
{
  "answer": "作为一个 AI 助手，我无法实时获取天气数据..."
}
```

### GET /avatar/token
获取虚拟人 WebRTC 令牌（由前端自动调用）。

**查询参数：**
- `region` — Azure 语音资源地区（例如 `swedencentral`）

**响应：**
```json
{
  "Urls": ["..."],
  "Username": "...",
  "Password": "..."
}
```

### GET /config
获取前端配置信息。

**响应：**
```json
{
  "azureSpeech": {
    "region": "swedencentral",
    "hasKey": true
  },
  "avatar": {
    "character": "lisa",
    "style": "casual-sitting",
    "voice": "zh-CN-XiaoxiaoNeural"
  }
}
```

## 故障排除

### 连接失败
- 检查 Azure Speech API 密钥是否有效
- 确保 Speech 服务启用了虚拟人功能
- 检查地区设置是否正确

### 虚拟人不讲话
- 验证 TTS 声音名称是否有效（检查 Azure 文档的支持列表）
- 确认 Azure OpenAI 部署名称正确
- 查看浏览器控制台和后端日志了解具体错误

### 视频不显示
- 确保浏览器支持 WebRTC
- 检查防火墙是否阻止 WebRTC 连接
- 查看浏览器网络选项卡确认 ICE 连接

## 参考资源

- [Azure Speech Avatar 文档](https://learn.microsoft.com/azure/ai-services/speech-service/avatar-overview)
- [Azure OpenAI 文档](https://learn.microsoft.com/azure/ai-services/openai/)
- [WebRTC 入门](https://webrtc.org/)

## 许可证

MIT
