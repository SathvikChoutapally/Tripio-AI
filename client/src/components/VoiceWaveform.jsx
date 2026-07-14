import React, { useEffect, useRef } from 'react';

export default function VoiceWaveform({ isRecording, stream }) {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const dataArrayRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // Clear Canvas initially
    ctx.clearRect(0, 0, width, height);

    // ── Setup audio analyzer if mic stream exists ────────────
    if (isRecording && stream) {
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const audioCtx = new AudioContextClass();
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64; // Low resolution is fine for simple waveform
        
        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        audioContextRef.current = audioCtx;
        analyserRef.current = analyser;
        dataArrayRef.current = dataArray;
      } catch (err) {
        console.warn('AudioContext setup failed, fallback to simulated waveform:', err);
      }
    }

    // ── Drawing loop ──────────────────────────────────────────
    const draw = () => {
      ctx.fillStyle = 'rgba(10, 10, 30, 0.2)'; // slight trail
      ctx.fillRect(0, 0, width, height);

      const barWidth = 4;
      const barGap = 3;
      const numBars = Math.floor(width / (barWidth + barGap));
      
      let amplitudes = [];

      if (isRecording) {
        if (analyserRef.current && dataArrayRef.current) {
          // Real Audio amplitude
          analyserRef.current.getByteFrequencyData(dataArrayRef.current);
          const rawData = Array.from(dataArrayRef.current);
          
          // Downsample to fit number of bars
          for (let i = 0; i < numBars; i++) {
            const index = Math.floor((i / numBars) * rawData.length);
            const value = rawData[index] || 0;
            amplitudes.push(value / 255.0); // normalize (0 to 1)
          }
        } else {
          // Simulated Waveform if mic stream is unavailable
          const time = Date.now() * 0.005;
          for (let i = 0; i < numBars; i++) {
            const rawVal = Math.sin(i * 0.2 + time) * Math.cos(i * 0.05 - time * 0.5);
            amplitudes.push(Math.abs(rawVal) * 0.7 + 0.1);
          }
        }
      } else {
        // Flatline
        for (let i = 0; i < numBars; i++) {
          amplitudes.push(0.02);
        }
      }

      // Draw symmetrical waveform
      for (let i = 0; i < numBars; i++) {
        const x = i * (barWidth + barGap) + barGap;
        const amp = amplitudes[i];
        const barHeight = Math.max(4, amp * height * 0.85);
        const y = (height - barHeight) / 2;

        // Gradient from brand indigo to teal
        const gradient = ctx.createLinearGradient(x, y, x, y + barHeight);
        gradient.addColorStop(0, '#4f5fff'); // Indigo
        gradient.addColorStop(0.5, '#8b5cf6'); // Violet
        gradient.addColorStop(1, '#14b8a6'); // Teal

        ctx.fillStyle = gradient;
        
        // Rounded bars
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 2);
        ctx.fill();
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, [isRecording, stream]);

  return (
    <canvas
      ref={canvasRef}
      width={120}
      height={32}
      className="bg-transparent opacity-80"
    />
  );
}
