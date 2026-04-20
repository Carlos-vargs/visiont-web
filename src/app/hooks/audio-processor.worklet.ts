declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}

declare function registerProcessor(
  name: string,
  processorCtor: typeof AudioWorkletProcessor,
): void;

export class AudioProcessor extends AudioWorkletProcessor {
  private chunkSize: number;
  private buffer: Float32Array;
  private bufferIndex: number;

  constructor(options?: AudioWorkletNodeOptions) {
    super();
    this.chunkSize = options?.processorOptions?.chunkSize || 1024;
    this.buffer = new Float32Array(this.chunkSize);
    this.bufferIndex = 0;

    this.port.onmessage = (event) => {
      if (event.data?.type === 'stop') {
        this.bufferIndex = 0;
        this.buffer.fill(0);
      }
    };
  }

  process(inputs: Float32Array[][], _outputs: Float32Array[][]): boolean {
    const input = inputs[0];
    
    if (input?.[0]) {
      const inputData = input[0];
      
      for (let i = 0; i < inputData.length; i++) {
        this.buffer[this.bufferIndex++] = inputData[i];
        
        if (this.bufferIndex >= this.chunkSize) {
          const int16Data = new Int16Array(this.chunkSize);
          for (let j = 0; j < this.chunkSize; j++) {
            const s = Math.max(-1, Math.min(1, this.buffer[j]));
            int16Data[j] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }

          const rms = Math.sqrt(
            this.buffer.reduce((sum, val) => sum + val * val, 0) / this.chunkSize
          );

          this.port.postMessage(
            {
              type: 'audio-chunk',
              pcmData: int16Data.buffer,
              audioLevel: Math.min(rms * 5, 1)
            },
            [int16Data.buffer]
          );

          this.bufferIndex = 0;
        }
      }
    }
    
    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
