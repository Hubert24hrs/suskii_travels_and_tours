/** Bundled images resolve to an asset id that `<Image source>` accepts. */
declare module '*.png' {
  const source: number;
  export default source;
}
