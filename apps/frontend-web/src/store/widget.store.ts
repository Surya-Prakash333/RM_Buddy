import { create } from 'zustand';
import type { WidgetPayload } from '@/types';

interface WidgetState {
  widgets: WidgetPayload[];
  setWidgets: (widgets: WidgetPayload[]) => void;
  clearWidgets: () => void;
}

export const useWidgetStore = create<WidgetState>((set) => ({
  widgets: [],
  setWidgets: (widgets) => set({ widgets }),
  clearWidgets: () => set({ widgets: [] }),
}));
