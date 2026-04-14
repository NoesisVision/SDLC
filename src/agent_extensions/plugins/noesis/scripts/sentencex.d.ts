declare module "sentencex" {
  function segment(language: string, text: string): Iterable<string>;
  function get_sentence_boundaries(
    language: string,
    text: string,
  ): Iterable<[number, number]>;
  export { segment, get_sentence_boundaries };
  export default segment;
}
