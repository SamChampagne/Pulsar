// Vitest (Vite) resolves `?raw` imports to the file contents as a string. Declared here so the
// specs of this folder can read the .edi fixtures without any Node import.
declare module '*.edi?raw' {
  const content: string;
  export default content;
}
