declare module "@xenova/transformers" {
  export const env: {
    allowLocalModels: boolean;
    backends: {
      onnx: {
        wasm: {
          numThreads: number;
          [key: string]: unknown;
        };
        [key: string]: unknown;
      };
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };

  export function pipeline(
    task: string,
    model: string,
    options?: Record<string, unknown>,
  ): Promise<
    (
      text: string,
      options?: { pooling?: string; normalize?: boolean },
    ) => Promise<{ data: Float32Array | number[]; dims?: number[] }>
  >;
}
