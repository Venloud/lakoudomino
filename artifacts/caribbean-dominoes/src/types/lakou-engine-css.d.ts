declare global {
  namespace React {
    interface CSSProperties {
      "--lk-fx"?: string | number;
      "--lk-fy"?: string | number;
      "--lk-turn"?: string | number;
      "--lk-seat"?: string | number;
      "--lk-glow-delay"?: string | number;
    }
  }
}

export {};