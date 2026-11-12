// Microphone tap for voice chat (browser/voice.mjs): forwards the first input channel in 1024-sample blocks at the
// capture context's rate. Runs only while voice.mjs holds a microphone stream (push-to-talk).
class VoiceCapture extends AudioWorkletProcessor{
 constructor(){super();this.buffer=new Float32Array(1024);this.length=0;}
 process(inputs){const channel=inputs[0]?.[0];
  if(channel)for(let i=0;i<channel.length;i++){this.buffer[this.length++]=channel[i];if(this.length===this.buffer.length){this.port.postMessage(this.buffer,[this.buffer.buffer]);this.buffer=new Float32Array(1024);this.length=0;}}
  return true;}
}
registerProcessor('rlb-voice-capture',VoiceCapture);
