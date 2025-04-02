// required dom elements
const buttonEl = document.getElementById("button");
const titleEl = document.getElementById("real-time-title");
const originalTextEl = document.getElementById("original-text");
const translatedTextEl = document.getElementById("translated-text");

// set initial state of application variables
let isRecording = false;
let rt;
let microphone;
let lastProcessedIndex = 0;

// 添加格式化时间的函数
function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('zh-CN', { 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit',
    hour12: false 
  });
}

// 添加格式化文本的函数
function formatTranscript(text, confidence) {
  const confidenceClass = confidence > 0.9 ? 'high-confidence' : 
                         confidence > 0.7 ? 'medium-confidence' : 'low-confidence';
  return `<span class="${confidenceClass}">${text}</span>`;
}

// 添加已翻译文本的缓存
const translatedCache = new Map();

function createMicrophone() {
  let stream;
  let audioContext;
  let audioWorkletNode;
  let source;
  let audioBufferQueue = new Int16Array(0);
  return {
    async requestPermission() {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    },
    async startRecording(onAudioCallback) {
      if (!stream) stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContext = new AudioContext({
        sampleRate: 16_000,
        latencyHint: 'balanced'
      });
      source = audioContext.createMediaStreamSource(stream);

      await audioContext.audioWorklet.addModule('audio-processor.js');
      audioWorkletNode = new AudioWorkletNode(audioContext, 'audio-processor');

      source.connect(audioWorkletNode);
      audioWorkletNode.connect(audioContext.destination);
      audioWorkletNode.port.onmessage = (event) => {
        const currentBuffer = new Int16Array(event.data.audio_data);
        audioBufferQueue = mergeBuffers(
          audioBufferQueue,
          currentBuffer
        );

        const bufferDuration =
          (audioBufferQueue.length / audioContext.sampleRate) * 1000;

        // wait until we have 100ms of audio data
        if (bufferDuration >= 100) {
          const totalSamples = Math.floor(audioContext.sampleRate * 0.1);

          const finalBuffer = new Uint8Array(
            audioBufferQueue.subarray(0, totalSamples).buffer
          );

          audioBufferQueue = audioBufferQueue.subarray(totalSamples)
          if (onAudioCallback) onAudioCallback(finalBuffer);
        }
      }
    },
    stopRecording() {
      stream?.getTracks().forEach((track) => track.stop());
      audioContext?.close();
      audioBufferQueue = new Int16Array(0);
    }
  }
}
function mergeBuffers(lhs, rhs) {
  const mergedBuffer = new Int16Array(lhs.length + rhs.length)
  mergedBuffer.set(lhs, 0)
  mergedBuffer.set(rhs, lhs.length)
  return mergedBuffer
}

// 处理翻译的函数
async function translateText(text, timestamp) {
  try {
    // 检查是否已经翻译过
    if (translatedCache.has(text)) {
      return {
        translation: translatedCache.get(text),
        timestamp: timestamp
      };
    }

    const response = await fetch("/translate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });
    const data = await response.json();
    
    // 存入缓存
    translatedCache.set(text, data.translation);
    
    return {
      translation: data.translation,
      timestamp: timestamp
    };
  } catch (error) {
    console.error("Translation error:", error);
    return {
      translation: "翻译出错",
      timestamp: timestamp
    };
  }
}

// 处理文本分割和翻译的函数
async function processText(text, timestamp) {
  const sentences = text.split(/(?<=\.)\s+/);
  let currentText = "";
  
  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim();
    if (trimmedSentence) {
      currentText += trimmedSentence + " ";
      if (trimmedSentence.endsWith(".")) {
        const { translation } = await translateText(currentText.trim(), timestamp);
        const transcriptDiv = document.createElement('div');
        transcriptDiv.className = 'transcript-item translation-item';
        transcriptDiv.innerHTML = `
          <span class="timestamp">[${formatTime(timestamp)}]</span>
          <span class="translation-text">${translation}</span>
        `;
        translatedTextEl.appendChild(transcriptDiv);
        translatedTextEl.scrollTop = translatedTextEl.scrollHeight;
        currentText = "";
      }
    }
  }
}

// runs real-time transcription and handles global variables
const run = async () => {
  if (isRecording) {
    if (rt) {
      await rt.close(false);
      rt = null;
    }

    if (microphone) {
      microphone.stopRecording();
      microphone = null;
    }
  } else {
    microphone = createMicrophone();
    await microphone.requestPermission();

    const response = await fetch("/token");
    const data = await response.json();

    if (data.error) {
      alert(data.error);
      return;
    }

    rt = new assemblyai.RealtimeService({ token: data.token });
    // handle incoming messages to display transcription to the DOM
    const texts = {};
    rt.on("transcript", (message) => {
      let msg = "";
      const timestamp = message.audio_start;
      texts[timestamp] = {
        text: message.text,
        confidence: message.confidence,
        timestamp: formatTime(timestamp)
      };
      
      const keys = Object.keys(texts);
      keys.sort((a, b) => a - b);
      
      // 清空现有内容
      originalTextEl.innerHTML = '';
      
      // 创建新的内容
      for (const key of keys) {
        if (texts[key]) {
          const { text, confidence, timestamp } = texts[key];
          const formattedText = formatTranscript(text, confidence);
          const transcriptDiv = document.createElement('div');
          transcriptDiv.className = 'transcript-item';
          transcriptDiv.innerHTML = `
            <span class="timestamp">[${timestamp}]</span>
            ${formattedText}
          `;
          originalTextEl.appendChild(transcriptDiv);
        }
      }
      
      // 自动滚动到底部
      originalTextEl.scrollTop = originalTextEl.scrollHeight;
      
      // 处理翻译
      processText(message.text, timestamp);
    });

    rt.on("error", async (error) => {
      console.error(error);
      await rt.close();
    });

    rt.on("close", (event) => {
      console.log(event);
      rt = null;
    });

    await rt.connect();
    // once socket is open, begin recording

    await microphone.startRecording((audioData) => {
      rt.sendAudio(audioData);
    });
  }

  isRecording = !isRecording;
  buttonEl.innerText = isRecording ? "Stop" : "Record";
  titleEl.innerText = isRecording
    ? "Click stop to end recording!"
    : "Click start to begin recording!";
};

buttonEl.addEventListener("click", () => run());

