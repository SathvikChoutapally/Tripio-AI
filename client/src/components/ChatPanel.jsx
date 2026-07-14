import React, { useState, useEffect, useRef } from 'react';
import { useTripStore } from '../store/tripStore';
import { Mic, MicOff, Send, Volume2, VolumeX, Sparkles, Loader2, Play, Circle } from 'lucide-react';
import VoiceWaveform from './VoiceWaveform';

export default function ChatPanel({ tripId }) {
  const {
    chatMessages,
    sendMessage,
    isStreaming,
    streamLogs,
    streamError,
    currentStreamingResponse,
    activeNode,
  } = useTripStore();

  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(false);
  const [micStream, setMicStream] = useState(null);

  const messagesEndRef = useRef(null);
  const recognitionRef = useRef(null);
  const synthRef = useRef(window.speechSynthesis);

  // Auto-scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, currentStreamingResponse]);

  // ── Setup Speech Recognition (Web Speech API) ────────────────
  useEffect(() => {
    const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognitionClass) {
      const rec = new SpeechRecognitionClass();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-US';

      rec.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }

        setInputText(prev => {
          const base = prev.trim();
          const added = finalTranscript || interimTranscript;
          return base ? `${base} ${added}` : added;
        });
      };

      rec.onerror = (e) => {
        console.error('Speech recognition error:', e);
        setIsRecording(false);
      };

      rec.onend = () => {
        setIsRecording(false);
      };

      recognitionRef.current = rec;
    }
  }, []);

  // ── Speech Synthesis: Read back assistant replies ────────────
  useEffect(() => {
    // Only synthesize when streaming is done, voice output is enabled, and there is a last message from assistant
    if (!isStreaming && voiceOutputEnabled && chatMessages.length > 0) {
      const lastMsg = chatMessages[chatMessages.length - 1];
      if (lastMsg.role === 'assistant') {
        speakText(lastMsg.content);
      }
    }
  }, [isStreaming, voiceOutputEnabled, chatMessages]);

  const speakText = (text) => {
    if (!synthRef.current) return;
    synthRef.current.cancel(); // stop current utterance

    // Remove markdown symbols from readback for clean speech
    const cleanText = text
      .replace(/[*#`_\-]/g, '')
      .replace(/\[.*?\]\(.*?\)/g, '')
      .trim();

    const utterance = new SpeechSynthesisUtterance(cleanText.slice(0, 400)); // limit speech size
    utterance.rate = 1.0;
    synthRef.current.speak(utterance);
  };

  const handleMicToggle = async () => {
    if (!recognitionRef.current) {
      alert('Voice recognition not supported on this browser. Try Chrome/Edge.');
      return;
    }

    if (isRecording) {
      recognitionRef.current.stop();
      if (micStream) {
        micStream.getTracks().forEach(t => t.stop());
        setMicStream(null);
      }
      setIsRecording(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setMicStream(stream);
        recognitionRef.current.start();
        setIsRecording(true);
      } catch (err) {
        console.error('Mic permission denied:', err);
      }
    }
  };

  const handleSend = () => {
    if (!inputText.trim()) return;
    sendMessage(tripId, inputText);
    setInputText('');
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0a25]/90 border border-white/5 rounded-3xl overflow-hidden backdrop-blur-2xl shadow-glass">
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/5 bg-[#101035] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-brand-400 animate-pulse" />
          <div>
            <h3 className="font-display font-bold text-sm tracking-tight">Tripio Planning Agent</h3>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="relative flex h-2 w-2">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isStreaming ? 'bg-brand-400' : 'bg-teal-400'}`}></span>
                <span className={`relative inline-flex rounded-full h-2 w-2 ${isStreaming ? 'bg-brand-500' : 'bg-teal-500'}`}></span>
              </span>
              <span className="text-[10px] text-white/50 font-medium">
                {isStreaming ? `Agent: ${activeNode || 'planning'}...` : 'Ready to customize'}
              </span>
            </div>
          </div>
        </div>

        {/* Voice toggle */}
        <button
          onClick={() => {
            setVoiceOutputEnabled(!voiceOutputEnabled);
            if (voiceOutputEnabled && synthRef.current) {
              synthRef.current.cancel();
            }
          }}
          className={`p-2.5 rounded-xl border transition-all ${
            voiceOutputEnabled
              ? 'bg-brand-500/20 border-brand-500/30 text-brand-400'
              : 'border-white/5 text-white/40 hover:text-white/60'
          }`}
          title={voiceOutputEnabled ? 'Mute Voice Assistant' : 'Enable Voice Assistant'}
        >
          {voiceOutputEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
        </button>
      </div>

      {/* Message logs/history */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {chatMessages.length === 0 && !isStreaming && (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-white/40">
            <Sparkles className="w-8 h-8 mb-3 text-brand-500/50" />
            <p className="text-sm font-medium text-white/60">Say hello to Tripio!</p>
            <p className="text-xs max-w-xs mt-1">Ask questions or tell me to change flights/hotels or make the trip cheaper.</p>
          </div>
        )}

        {chatMessages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${
              msg.role === 'user' ? 'items-end' : 'items-start'
            }`}
          >
            <span className="text-[9px] text-white/30 mb-0.5 px-1 font-mono uppercase">
              {msg.role}
            </span>
            <div
              className={`text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user' ? 'chat-bubble-user' : 'chat-bubble-assistant'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {/* Real-time Streaming Response */}
        {currentStreamingResponse && (
          <div className="flex flex-col items-start">
            <span className="text-[9px] text-brand-400 mb-0.5 px-1 font-mono uppercase animate-pulse">
              streaming response
            </span>
            <div className="chat-bubble-assistant text-sm leading-relaxed whitespace-pre-wrap border-brand-500/20 bg-brand-500/5">
              {currentStreamingResponse}
              <span className="inline-block w-1.5 h-4 bg-brand-400 animate-pulse ml-0.5" />
            </div>
          </div>
        )}

        {/* Live tool step/logs execution overlay */}
        {isStreaming && streamLogs.length > 0 && (
          <div className="mt-4 p-3.5 bg-black/35 rounded-2xl border border-white/5 font-mono text-[10px] text-white/60 space-y-1 bg-gradient-to-r from-brand-950/20 to-teal-950/10">
            <div className="flex items-center gap-1.5 text-teal-400 font-bold mb-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span className="tracking-wide uppercase text-[9px]">Agent Thought Log:</span>
            </div>
            {streamLogs.slice(-3).map((log, index) => (
              <div key={index} className="flex items-start gap-1">
                <span className="text-brand-400 select-none">▶</span>
                <span className="break-all">{log}</span>
              </div>
            ))}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Footer input form */}
      <div className="p-4 border-t border-white/5 bg-[#101035] space-y-3">
        {streamError && (
          <p className="text-red-400 text-xs px-2 py-1 bg-red-500/10 border border-red-500/20 rounded-xl">
            ⚠️ {streamError}
          </p>
        )}

        <div className="flex items-center gap-2">
          {/* Mic transcription button */}
          <button
            onClick={handleMicToggle}
            className={`p-3 rounded-xl transition-all flex items-center justify-center ${
              isRecording
                ? 'bg-red-500 text-white animate-pulse shadow-md shadow-red-500/40'
                : 'bg-white/5 border border-white/10 hover:bg-white/10 text-white/70'
            }`}
            title={isRecording ? 'Stop Recording' : 'Start Voice Input'}
            disabled={isStreaming}
          >
            {isRecording ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>

          {/* Text Input */}
          <div className="flex-1 relative flex items-center">
            <input
              type="text"
              placeholder={isRecording ? 'Listening to speech...' : 'Type feedback, e.g. "make it cheaper"'}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              className="input-glass pr-12 w-full"
              disabled={isStreaming}
            />
            {isRecording && (
              <div className="absolute right-3">
                <VoiceWaveform isRecording={isRecording} stream={micStream} />
              </div>
            )}
          </div>

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={!inputText.trim() || isStreaming}
            className="p-3.5 bg-brand-500 hover:bg-brand-600 disabled:opacity-40 text-white rounded-xl shadow-brand transition-all flex items-center justify-center active:scale-95"
          >
            {isStreaming ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
