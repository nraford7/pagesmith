export interface FormatMeta {
  widthPx: number;
  heightPx: number;
  aspect: string;
  framed: boolean;
}

export const formatMeta: Record<string, FormatMeta> = {
  desktop:      { widthPx: 1280, heightPx: 0,    aspect: '',      framed: false },
  a4:           { widthPx: 794,  heightPx: 1123,  aspect: '1:1.41', framed: true },
  'slide-16-9': { widthPx: 1280, heightPx: 720,   aspect: '16:9',  framed: true },
  'slide-4-3':  { widthPx: 960,  heightPx: 720,   aspect: '4:3',   framed: true },
};

export const devices = [
  { id: 'desktop', name: 'Desktop', width: '' },
  { id: 'a4', name: 'A4', width: '210mm', height: '297mm' },
  { id: 'slide-16-9', name: 'Slide 16:9', width: '13.333in', height: '7.5in' },
  { id: 'slide-4-3', name: 'Slide 4:3', width: '10in', height: '7.5in' },
];
