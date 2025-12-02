// VirtualMan 实时虚拟人前端
// 全局对象
var avatarSynthesizer;
var peerConnection;
var messages = [];
var backendUrl = 'http://localhost:8000';
var recognizer = null;
var isRecognizing = false;
var currentAuthToken = null;
var currentRegion = null;
var autoMode = false; // whether recognition should auto-submit and restart

const log = (msg, type = 'info') => {
    const time = new Date().toLocaleTimeString('zh-CN');
    const entry = `[${time}] ${msg}`;
    console.log(`[${type.toUpperCase()}] ${msg}`);
    const statusDiv = document.getElementById('status');
    if (statusDiv) {
        const p = document.createElement('div');
        p.textContent = entry;
        p.className = `status-${type}`;
        statusDiv.appendChild(p);
        // keep last 6 messages
        while (statusDiv.childNodes.length > 6) {
            statusDiv.removeChild(statusDiv.firstChild);
        }
    }
}

const addChatMessage = (role, text) => {
    const historyDiv = document.getElementById('chatHistory');
    const roleText = role === 'user' ? '您' : '虚拟人';
    const className = role === 'user' ? 'user-message' : 'avatar-message';
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message-item ' + className;
    messageDiv.innerHTML = `<strong>${roleText}:</strong> ${text}`;
    historyDiv.appendChild(messageDiv);
    historyDiv.scrollTop = historyDiv.scrollHeight;
    messages.push({ role, text });
}

// 开始对话
async function startSession() {
    try {
        log('正在连接到虚拟人服务...');
        
        // 从后端获取配置和令牌
        const configResponse = await fetch(`${backendUrl}/config`);
        if (!configResponse.ok) {
            throw new Error('获取配置失败');
        }
        const config = await configResponse.json();
        
        const region = config.azureSpeech.region;
        const avatar = config.avatar;
        
        // 获取 WebRTC 令牌
        const tokenResponse = await fetch(`${backendUrl}/avatar/token?region=${region}`);
        if (!tokenResponse.ok) {
            throw new Error('获取令牌失败');
        }
        const tokenData = await tokenResponse.json();
        const iceServerUrl = tokenData.Urls && tokenData.Urls[0];
        const iceServerUsername = tokenData.Username;
        const iceServerCredential = tokenData.Password;
        const authToken = tokenData.authToken || tokenData.AuthorizationToken || tokenData.Token || null;
        
        // 保存 auth token/region 供识别使用，并设置 WebRTC
        currentAuthToken = authToken;
        currentRegion = region;
        // 设置 WebRTC（传入 authToken，由后端短期签发）
        setupWebRTC(iceServerUrl, iceServerUsername, iceServerCredential, region, avatar, authToken);
        
        document.getElementById('startSession').disabled = true;
        document.getElementById('stopSession').disabled = false;
        document.getElementById('send').disabled = false;
        document.getElementById('messageInput').disabled = false;
        // 启用麦克风按钮
        const micBtn = document.getElementById('micBtn');
        if (micBtn) { micBtn.disabled = false; micBtn.textContent = '🎤'; }
        
        log('虚拟人服务已连接');
    } catch (error) {
        log(`连接失败: ${error.message}`, 'error');
        alert(`连接失败: ${error.message}`);
    }

}

// 设置 WebRTC
function setupWebRTC(iceServerUrl, iceServerUsername, iceServerCredential, region, avatar, authToken) {
    try {
        // 使用后端签发的短期 auth token（优先）或抛出错误如果没有
        let speechConfig;
        if (authToken) {
            speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(authToken, region);
        } else {
            throw new Error('missing speech auth token from server');
        }

        // 创建 Avatar 配置
        const avatarConfig = new SpeechSDK.AvatarConfig(avatar.character, avatar.style);
        avatarSynthesizer = new SpeechSDK.AvatarSynthesizer(speechConfig, avatarConfig);
        
        avatarSynthesizer.avatarEventReceived = function (s, e) {
            log(`虚拟人事件: ${e.description}`);
        };
        
        // 创建 WebRTC 对等连接
        peerConnection = new RTCPeerConnection({
            iceServers: [{
                urls: [iceServerUrl],
                username: iceServerUsername,
                credential: iceServerCredential
            }]
        });
        
        // 监听流（分别处理 video / audio）
        peerConnection.ontrack = function (event) {
            const videoElement = document.getElementById('remoteVideo');
            try {
                const stream = event.streams[0];
                if (!stream) return;

                if (event.track.kind === 'video') {
                    log('收到视频轨道，附加到 video 元素');
                    // 将视频流绑定到 video 元素（静音，以免重复播放音频）
                    videoElement.srcObject = stream;
                    videoElement.muted = true; // 视频元素静音，音频通过独立 audio 播放
                    videoElement.play().catch(e => log('video play 被阻止: ' + e, 'warn'));
                }

                if (event.track.kind === 'audio') {
                    log('收到音频轨道，创建 audio 元素播放');
                    // 为音频创建独立元素，确保不被静音且可播放
                    let audioEl = document.getElementById('remoteAudio');
                    if (!audioEl) {
                        audioEl = document.createElement('audio');
                        audioEl.id = 'remoteAudio';
                        audioEl.autoplay = true;
                        audioEl.controls = false;
                        audioEl.style.display = 'none';
                        document.body.appendChild(audioEl);
                    }
                    audioEl.srcObject = stream;
                    audioEl.muted = false;
                    audioEl.volume = 1.0;
                    audioEl.play().then(()=> log('音频开始播放')).catch(err => log('audio play 错误: ' + err, 'error'));
                }
            } catch (e) {
                log('ontrack 处理异常: ' + e, 'error');
            }
        };
        
        // 监听数据通道
        peerConnection.addEventListener('datachannel', event => {
            const dataChannel = event.channel;
            dataChannel.onmessage = e => {
                const webRTCEvent = JSON.parse(e.data);
                console.log('[WebRTC Event] ' + e.data);
            };
        });
        
        // 创建数据通道以便侦听
        const c = peerConnection.createDataChannel('eventChannel');
        
        // 监听连接状态
        peerConnection.oniceconnectionstatechange = e => {
            log(`WebRTC 状态: ${peerConnection.iceConnectionState}`);
            if (peerConnection.iceConnectionState === 'failed' || peerConnection.iceConnectionState === 'disconnected') {
                document.getElementById('stopSession').disabled = true;
                document.getElementById('send').disabled = true;
                document.getElementById('messageInput').disabled = true;
                document.getElementById('startSession').disabled = false;
            }
        };
        
        // 添加收发器
        peerConnection.addTransceiver('video', { direction: 'sendrecv' });
        peerConnection.addTransceiver('audio', { direction: 'sendrecv' });
        
        // 启动虚拟人并建立 WebRTC 连接
        avatarSynthesizer.startAvatarAsync(peerConnection).then((r) => {
            if (r.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
                log('虚拟人已启动');
            } else {
                log(`启动虚拟人失败: ${r.reason}`, 'error');
                if (r.reason === SpeechSDK.ResultReason.Canceled) {
                    const cancellationDetails = SpeechSDK.CancellationDetails.fromResult(r);
                    log(`取消详情: ${cancellationDetails.errorDetails}`, 'error');
                }
                document.getElementById('startSession').disabled = false;
            }
        }).catch(error => {
            log(`启动失败: ${error}`, 'error');
            document.getElementById('startSession').disabled = false;
        });
    } catch (error) {
        log(`WebRTC 设置失败: ${error.message}`, 'error');
        document.getElementById('startSession').disabled = false;
    }
}

// 语音识别控制
function toggleMic() {
    if (isRecognizing) {
        stopRecognition();
    } else {
        startRecognition();
    }
}

function startRecognition() {
    if (!currentAuthToken || !currentRegion) {
        alert('尚未获取语音授权 token，请先开始会话');
        return;
    }
    try {
        const micBtn = document.getElementById('micBtn');
        micBtn.textContent = '◼ 停止录音';
        micBtn.disabled = false;

        const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
        const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(currentAuthToken, currentRegion);
        // 默认语言为 zh-CN，必要时可改为用户选择
        speechConfig.speechRecognitionLanguage = 'zh-CN';

        recognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);
        isRecognizing = true;

        recognizer.recognizing = (s, e) => {
            // 临时结果显示在输入框
            const input = document.getElementById('messageInput');
            if (input) input.value = e.result.text;
        };

        recognizer.recognized = (s, e) => {
            if (e.result && e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
                const input = document.getElementById('messageInput');
                const text = e.result.text && e.result.text.trim();
                if (input) input.value = text || '';
                if (text) {
                    // 用户已停止说话（final result），自动提交
                    autoMode = true;
                    try {
                        stopRecognition();
                    } catch (err) {
                        log('停止识别时出错: ' + err, 'warn');
                    }
                    // 延迟微小时间以确保停止完成
                    setTimeout(() => {
                        sendMessage();
                    }, 150);
                }
            }
        };

        recognizer.canceled = (s, e) => {
            log('识别被取消: ' + e.errorDetails, 'warn');
            stopRecognition();
        };

        recognizer.startContinuousRecognitionAsync(() => {
            log('开始麦克风识别');
        }, err => {
            log('startContinuousRecognitionAsync 错误: ' + err, 'error');
            isRecognizing = false;
            const micBtn = document.getElementById('micBtn'); if (micBtn) micBtn.textContent = '🎤';
        });
    } catch (e) {
        log('startRecognition 异常: ' + e, 'error');
    }
}

function stopRecognition() {
    if (!recognizer) return;
    const micBtn = document.getElementById('micBtn');
    micBtn.disabled = true;
    recognizer.stopContinuousRecognitionAsync(() => {
        log('已停止麦克风识别');
        isRecognizing = false;
        if (micBtn) { micBtn.textContent = '🎤'; micBtn.disabled = false; }
        recognizer.close(); recognizer = null;
    }, err => {
        log('stopContinuousRecognitionAsync 错误: ' + err, 'error');
        isRecognizing = false;
        if (micBtn) { micBtn.textContent = '🎤'; micBtn.disabled = false; }
        recognizer = null;
    });
}

// 发送消息
async function sendMessage() {
    const userMessage = document.getElementById('messageInput').value.trim();
    if (!userMessage) return;
    
    if (!avatarSynthesizer) {
        alert('请先开始对话');
        return;
    }
    
    addChatMessage('user', userMessage);
    document.getElementById('messageInput').value = '';
    
    try {
        log('正在调用 OpenAI API...');
        
        // 调用后端 /ask 端点
        const response = await fetch(`${backendUrl}/ask`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: userMessage })
        });
        
        if (!response.ok) {
            const error = await response.text();
            throw new Error(error);
        }
        
        const data = await response.json();
        const answer = data.answer;
        
        addChatMessage('avatar', answer);
        log(`虚拟人: ${answer}`);
        
        // 让虚拟人讲话
        avatarSynthesizer.speakTextAsync(answer).then(result => {
            if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
                log('虚拟人讲话完成');
            } else if (result.reason === SpeechSDK.ResultReason.Canceled) {
                const details = SpeechSDK.CancellationDetails.fromResult(result);
                log(`讲话被取消: ${details.errorDetails}`, 'error');
            }
        }).catch(err => {
            log(`讲话失败: ${err}`, 'error');
        }).finally(() => {
            // 如果是自动识别模式，虚拟人说完后重新开始识别
            if (autoMode) {
                autoMode = false;
                // 给浏览器一点时间恢复音频通道
                setTimeout(() => {
                    try { startRecognition(); } catch (e) { log('重新启动识别失败: ' + e, 'error'); }
                }, 300);
            }
        });
        
    } catch (error) {
        log(`错误: ${error.message}`, 'error');
        alert(`错误: ${error.message}`);
    }
}

// 停止讲话
function stopSpeaking() {
    if (avatarSynthesizer) {
        avatarSynthesizer.stopSpeakingAsync();
        log('已停止讲话');
    }
}

// 停止对话
function stopSession() {
    if (avatarSynthesizer) {
        avatarSynthesizer.close();
    }
    if (peerConnection) {
        peerConnection.close();
    }
    
    // 重置 UI
    document.getElementById('startSession').disabled = false;
    document.getElementById('stopSession').disabled = true;
    document.getElementById('send').disabled = true;
    document.getElementById('messageInput').disabled = true;
    
    log('对话已停止');
}
