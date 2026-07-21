declare module '@diffusionstudio/piper-wasm' {
  interface PiperPhonemizeOptions {
    print?: (line: string) => void;
    printErr?: (line: string) => void;
    locateFile?: (file: string) => string;
  }

  interface PiperPhonemizeModule {
    callMain(args: string[]): number | void;
  }

  export default function createPiperPhonemize(
    options?: PiperPhonemizeOptions
  ): Promise<PiperPhonemizeModule>;
}
