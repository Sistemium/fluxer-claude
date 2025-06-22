export class TokenService {
  /**
   * Estimate the number of tokens in a text prompt
   * This is a simplified approximation since real CLIP tokenizer is more complex
   */
  static estimateTokens(prompt: string): number {
    if (!prompt) return 0
    
    // Split by spaces and common punctuation, filter empty strings
    const words = prompt
      .toLowerCase()
      .split(/[\s\.,;:!?\-\(\)\[\]"']+/)
      .filter(word => word.length > 0)
    
    // Estimate tokens - most words = 1 token, some compound words = 2 tokens
    let tokenEstimate = 0
    words.forEach(word => {
      if (word.length > 8) {
        tokenEstimate += 2 // Long words often split into 2 tokens
      } else {
        tokenEstimate += 1
      }
    })
    
    return tokenEstimate
  }
}