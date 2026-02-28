# 錄影提詞機 WebApp

這個專案是一個純前端 WebApp，整合了：

- 錄影（攝影機 + 麥克風，匯出 MP4 或 WebM）
- 提詞機（大字體滾動稿件）
- 語音轉文字跟隨（講到哪就跳到哪）
- 文字轉語音預覽（TTS）

## 本地執行

```bash
cd /Users/chenguanyu/Documents/提詞機
python3 -m http.server 8080
```

開啟：

`http://localhost:8080`

## 使用流程

1. 點擊「開啟設備」並允許攝影機/麥克風權限。  
2. 在「提詞稿」貼上內容（建議一行一句）。  
3. 點擊「載入提詞稿」。  
4. 語音跟隨預設為開啟，開始說話後系統會自動高亮目前句子。  
5. 點擊「開啟全螢幕提詞」，可在全螢幕下直接控制錄影、鏡像、字體大小。  
6. 全螢幕字幕在上方、控制列在底部；`↑ / ↓` 可切換上一句/下一句。  

## 技術說明

- 錄影：`MediaRecorder` + `getUserMedia`
- 語音識別：`SpeechRecognition` / `webkitSpeechRecognition`
- 文字轉語音：`speechSynthesis`
- 輸出格式：優先嘗試 `MP4`，不支援時自動回退 `WebM`
- 提詞稿快取：自動儲存在瀏覽器 `localStorage`

## 瀏覽器建議

建議使用最新版 Chrome / Edge。Safari 與 Firefox 對語音識別支援較弱，可能無法完整使用語音跟隨功能。
