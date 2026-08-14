import { describe, it, expect } from 'vitest';
import { parseCsv, mapCsvToProspects } from '@/lib/prospect-csv';

// Structure réelle d'un export Perplexity (prospects_fablab_nomade_montreal.csv).
const PERPLEXITY_CSV = [
  'Organisation,Réseau,Type,Zone,Courriel public,Téléphone,Priorité,Note',
  'Centre de services scolaire de Montréal,CSSDM,Organisme scolaire,Montréal,info@cssdm.gouv.qc.ca,514 596-6000,Priorité 1,Grand bassin d’écoles publiques à Montréal.',
  'École des métiers des Faubourgs-de-Montréal,CSSDM,École/centre,Montréal,emfm@cssdm.gouv.qc.ca,514 596-4600,Priorité 2,"Potentiel pour fabrication, prototypage et partenariats."',
  'École Léonard-De Vinci,CSSDM,École,Montréal,ldv@cssdm.gouv.qc.ca,514 596-4924 / 514 596-5512,Priorité 2,"Deux pavillons, bon volume potentiel."',
  '',
].join('\n');

describe('parseCsv', () => {
  it('gère guillemets, virgules internes et lignes vides', () => {
    const rows = parseCsv('a,"b, c",d\n"x ""y""",z,\n\n');
    expect(rows).toEqual([
      ['a', 'b, c', 'd'],
      ['x "y"', 'z', ''],
    ]);
  });
});

describe('mapCsvToProspects — export Perplexity', () => {
  it('mappe les en-têtes FR et compose les notes (Priorité/Réseau/Type + Note)', () => {
    const { prospects, analysis } = mapCsvToProspects(PERPLEXITY_CSV);
    expect(analysis.total).toBe(3);
    expect(analysis.withEmail).toBe(3);
    expect(analysis.unmappedHeaders).toEqual([]);

    const first = prospects[0];
    expect(first.name).toBe('Centre de services scolaire de Montréal');
    expect(first.organizationName).toBe('Centre de services scolaire de Montréal');
    expect(first.email).toBe('info@cssdm.gouv.qc.ca');
    expect(first.phone).toBe('514 596-6000');
    expect(first.city).toBe('Montréal');
    expect(first.notes).toContain('Priorité : Priorité 1');
    expect(first.notes).toContain('Réseau : CSSDM');
    expect(first.notes).toContain('Grand bassin');

    // La virgule DANS le champ Note ne casse pas la ligne.
    expect(prospects[1].notes).toContain('fabrication, prototypage');
  });

  it('ignore les lignes sans nom ni email et refuse les faux emails', () => {
    const { prospects, analysis } = mapCsvToProspects(
      // 2e ligne : un téléphone mais ni nom ni email → sautée (comptée).
      'Nom,Email,Téléphone\n,,514 111-2222\nAcme,pas-un-email,\nBravo,contact@bravo.ca,\n',
    );
    expect(analysis.total).toBe(2);
    expect(prospects[0].email).toBeNull(); // « pas-un-email » rejeté
    expect(prospects[1].email).toBe('contact@bravo.ca');
    expect(analysis.skipped).toBe(1);
  });
});
