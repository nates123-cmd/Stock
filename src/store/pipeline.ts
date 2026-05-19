import { Platform } from 'react-native';
import { create } from 'zustand';
import type { Ingredient, PipelineIdea } from '@/types';
import { migrate, pipelineRepo } from '@/lib/db';
import { webPersist } from '@/lib/db/webStore';
import { uid } from '@/lib/id';
import { seedPipeline } from '@/lib/seed';

/**
 * Pipeline store (spec §8) — half-formed ideas, kept separate from cooked
 * recipes until promoted or planned as an experiment. Same platform-split
 * persistence as the other pillars (SQLite native, in-memory seed on web).
 */
const NATIVE = Platform.OS !== 'web';

type Ref = { url: string; label: string };

type PipelineState = {
  ideas: PipelineIdea[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  getById: (id: string) => PipelineIdea | undefined;
  capture: (title: string, note: string) => Promise<string>;
  setDetails: (id: string, patch: { title?: string; note?: string }) => Promise<void>;
  setStatus: (id: string, status: PipelineIdea['status']) => Promise<void>;
  addReference: (id: string, ref: Ref) => Promise<void>;
  removeReference: (id: string, index: number) => Promise<void>;
  setBestGuess: (id: string, ingredients: Ingredient[]) => Promise<void>;
  promote: (id: string, recipeId: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

async function persist(idea: PipelineIdea): Promise<void> {
  if (!NATIVE) return;
  try {
    await pipelineRepo.upsert(idea);
  } catch (e) {
    console.warn('[stock] pipeline persist failed', e);
  }
}

export const usePipelineStore = create<PipelineState>((set, get) => ({
  ideas: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    if (NATIVE) {
      try {
        await migrate();
        let rows = await pipelineRepo.all();
        if (rows.length === 0) {
          for (const i of seedPipeline()) await pipelineRepo.upsert(i);
          rows = await pipelineRepo.all();
        }
        set({ ideas: rows, hydrated: true });
        return;
      } catch (e) {
        console.warn('[stock] pipeline hydrate failed, using seed', e);
      }
    }
    const saved = await webPersist.load<PipelineIdea[]>('pipeline');
    set({ ideas: saved ?? seedPipeline(), hydrated: true });
  },

  getById: (id) => get().ideas.find((i) => i.id === id),

  capture: async (title, note) => {
    const idea: PipelineIdea = {
      id: uid('idea'),
      title: title.trim() || 'Untitled idea',
      note: note.trim(),
      status: 'captured',
      references: [],
      createdAt: new Date(),
    };
    set((s) => ({ ideas: [idea, ...s.ideas] }));
    await persist(idea);
    return idea.id;
  },

  setDetails: async (id, patch) => {
    let updated: PipelineIdea | undefined;
    set((s) => ({
      ideas: s.ideas.map((i) => {
        if (i.id !== id) return i;
        updated = {
          ...i,
          title: patch.title?.trim() || i.title,
          note: patch.note !== undefined ? patch.note.trim() : i.note,
        };
        return updated;
      }),
    }));
    if (updated) await persist(updated);
  },

  setStatus: async (id, status) => {
    let updated: PipelineIdea | undefined;
    set((s) => ({
      ideas: s.ideas.map((i) => {
        if (i.id !== id) return i;
        updated = { ...i, status };
        return updated;
      }),
    }));
    if (updated) await persist(updated);
  },

  addReference: async (id, ref) => {
    let updated: PipelineIdea | undefined;
    set((s) => ({
      ideas: s.ideas.map((i) => {
        if (i.id !== id) return i;
        updated = { ...i, references: [...i.references, ref] };
        return updated;
      }),
    }));
    if (updated) await persist(updated);
  },

  removeReference: async (id, index) => {
    let updated: PipelineIdea | undefined;
    set((s) => ({
      ideas: s.ideas.map((i) => {
        if (i.id !== id) return i;
        updated = { ...i, references: i.references.filter((_, idx) => idx !== index) };
        return updated;
      }),
    }));
    if (updated) await persist(updated);
  },

  setBestGuess: async (id, ingredients) => {
    let updated: PipelineIdea | undefined;
    set((s) => ({
      ideas: s.ideas.map((i) => {
        if (i.id !== id) return i;
        updated = { ...i, bestGuessIngredients: ingredients };
        return updated;
      }),
    }));
    if (updated) await persist(updated);
  },

  promote: async (id, recipeId) => {
    let updated: PipelineIdea | undefined;
    set((s) => ({
      ideas: s.ideas.map((i) => {
        if (i.id !== id) return i;
        updated = { ...i, status: 'promoted', promotedRecipeId: recipeId };
        return updated;
      }),
    }));
    if (updated) await persist(updated);
  },

  remove: async (id) => {
    set((s) => ({ ideas: s.ideas.filter((i) => i.id !== id) }));
    if (NATIVE) {
      try {
        await pipelineRepo.remove(id);
      } catch (e) {
        console.warn('[stock] pipeline delete failed', e);
      }
    }
  },
}));

if (!NATIVE) {
  usePipelineStore.subscribe((s) => void webPersist.save('pipeline', s.ideas));
}
