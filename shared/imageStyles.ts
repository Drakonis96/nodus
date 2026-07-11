import type { DecorativeImageStyle } from './types';

export interface DecorativeImageStyleTemplate {
  id: DecorativeImageStyle;
  label: string;
  prompt: string;
}

/** One canonical style registry shared by Settings, Inmersión and Deep Research. */
export const DECORATIVE_IMAGE_STYLES: DecorativeImageStyleTemplate[] = [
  {
    id: 'antique_book',
    label: 'Ilustración antigua de libro',
    prompt: 'powerful antique book illustration, richly colored pigments, dramatic composition, aged paper texture',
  },
  {
    id: 'colored_engraving',
    label: 'Grabado coloreado',
    prompt: 'finely detailed hand-colored engraving, vivid restrained palette, engraved linework, aged paper',
  },
  {
    id: 'classic_scientific',
    label: 'Ilustración científica clásica',
    prompt: 'classic scientific plate, precise naturalist detail, elegant composition, saturated archival colors',
  },
  {
    id: 'watercolor',
    label: 'Acuarela',
    prompt: 'expressive watercolor illustration, luminous layered washes, organic edges, strong color accents',
  },
  {
    id: 'historical_collage',
    label: 'Collage histórico',
    prompt: 'historical collage illustration, archival paper fragments and imagery, bold layered color composition',
  },
  {
    id: 'modernist_poster',
    label: 'Cartel modernista',
    prompt: 'modernist poster illustration, geometric rhythm, bold flat colors, elegant period print texture',
  },
  {
    id: 'contemporary_editorial',
    label: 'Ilustración editorial contemporánea',
    prompt: 'contemporary editorial illustration, conceptually striking, clean shapes, sophisticated vivid palette',
  },
  {
    id: 'realistic_photo',
    label: 'Fotografía realista',
    prompt: 'photorealistic photograph, natural lighting, lifelike detail, shallow depth of field, high dynamic range',
  },
  {
    id: 'vintage_photograph',
    label: 'Fotografía histórica',
    prompt: 'vintage archival photograph, authentic period detail, aged film grain, faded tones, documentary realism',
  },
  {
    id: 'black_and_white',
    label: 'Blanco y negro',
    prompt: 'dramatic black and white photograph, rich tonal contrast, fine grain, timeless monochrome composition',
  },
  {
    id: 'cinematic',
    label: 'Cinematográfico',
    prompt: 'cinematic film still, dramatic lighting, atmospheric depth, moody color grade, widescreen composition',
  },
  {
    id: 'oil_painting',
    label: 'Pintura al óleo',
    prompt: 'classical oil painting, expressive brushwork, layered impasto texture, rich chiaroscuro, museum quality',
  },
];

export const DEFAULT_DECORATIVE_IMAGE_STYLE: DecorativeImageStyle = 'antique_book';

export function imageStyleTemplate(style: DecorativeImageStyle): DecorativeImageStyleTemplate {
  return DECORATIVE_IMAGE_STYLES.find((entry) => entry.id === style) ?? DECORATIVE_IMAGE_STYLES[0];
}

/** Deliberately compact: image cost should go to pixels, not a verbose prompt. */
export function buildDecorativeImagePrompt(style: DecorativeImageStyle, visualContext: string): string {
  const clean = visualContext.replace(/\s+/g, ' ').trim().slice(0, 260);
  return [
    imageStyleTemplate(style).prompt,
    clean,
    'single decorative landscape image, no text, no letters, no numbers, no logos, no watermark',
  ]
    .filter(Boolean)
    .join('. ')
    .slice(0, 560);
}
