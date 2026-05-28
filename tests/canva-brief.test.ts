import { describe, it, expect } from 'vitest';
import { CanvaService } from '@/services/canva/CanvaService';

describe('CanvaService.generateCanvaBrief', () => {
  it('produces a multi-section markdown brief', () => {
    const brief = CanvaService.generateCanvaBrief({
      brandName: 'Acme',
      format: 'INSTAGRAM_POST',
      topic: 'new product launch',
      tone: 'inspiring',
      audience: 'tech founders',
      cta: 'Learn more',
      primaryColor: '#3d62f5',
      visualStyle: 'minimal',
    });
    expect(brief).toContain('# Brief Canva — Acme');
    expect(brief).toContain('INSTAGRAM_POST');
    expect(brief).toContain('new product launch');
    expect(brief).toContain('tech founders');
    expect(brief).toContain('Learn more');
    expect(brief).toContain('#3d62f5');
    expect(brief).toContain('Composition recommandée');
    expect(brief).toContain('Conseils');
  });

  it('omits optional sections gracefully', () => {
    const brief = CanvaService.generateCanvaBrief({
      brandName: 'Solo',
      format: 'FLYER',
      topic: 'event',
    });
    expect(brief).toContain('Solo');
    expect(brief).not.toContain('null');
    expect(brief).not.toContain('undefined');
  });
});
