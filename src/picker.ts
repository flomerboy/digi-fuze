// The remix model picker: one dropdown of models grouped by provider, plus the effort and fast-mode controls that
// depend on it. Models come from the Anthropic catalogue and, once an OpenRouter key is connected, OpenRouter's live list.
import type { ModelInfo, Provider } from './remix/types';
import { ANTHROPIC_MODELS, DEFAULT_MODEL_KEY } from './remix/models';
import { fetchOpenRouterModels } from './remix/openrouter';
import { getKey } from './remix/keys';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

export class ModelPicker {
  private models: ModelInfo[] = [...ANTHROPIC_MODELS];
  private selectedKey = store.get('vgr:model-key') || DEFAULT_MODEL_KEY;
  private effortSel = $<HTMLSelectElement>('#effort');
  private fastBox = $<HTMLInputElement>('#fast');

  constructor() {
    $<HTMLSelectElement>('#model').onchange = (e) => {
      const sel = e.target as HTMLSelectElement;
      if (sel.value) this.select(sel.value);
      sel.blur();
    };
    this.effortSel.onchange = () => { store.set('vgr:effort', this.effortSel.value); this.effortSel.blur(); };
    this.fastBox.checked = store.get('vgr:fast') === '1';
    this.fastBox.onchange = () => { store.set('vgr:fast', this.fastBox.checked ? '1' : '0'); this.fastBox.blur(); };
    this.render();
  }

  /** Re-read which providers have keys (and load OpenRouter's list when one is connected). */
  async refresh() {
    const anthropic = ANTHROPIC_MODELS;
    let openrouter: ModelInfo[] = [];
    if (getKey('openrouter')) {
      try { openrouter = await fetchOpenRouterModels(); } catch { /* offline: keep Anthropic only */ }
    }
    this.models = [...anthropic, ...openrouter];
    this.render();
  }

  has(p: Provider) { return !!getKey(p); }

  /** The chosen model, steered to a provider the visitor actually has a key for. */
  get model(): ModelInfo {
    let m = this.models.find((x) => x.key === this.selectedKey) || this.models[0];
    if (!this.has(m.provider)) {
      const other: Provider = m.provider === 'anthropic' ? 'openrouter' : 'anthropic';
      if (this.has(other)) {
        // Prefer the same family through the other provider (Opus via OpenRouter, etc.), else that provider's first featured.
        const family = /opus|sonnet|fable|haiku/.exec(m.id)?.[0];
        m = this.models.find((x) => x.provider === other && x.featured && family && x.id.includes(family))
          || this.models.find((x) => x.provider === other && x.featured) || m;
      }
    }
    return m;
  }

  get effort(): string | null { return this.effortSel.disabled ? null : this.effortSel.value || null; }
  get fast(): boolean { return !!this.model.fast && this.fastBox.checked; }

  /** Find a model for continuing an existing remix's conversation (fixes), even if it's not in the current list. */
  modelFor(provider: Provider, id: string, label?: string): ModelInfo {
    return this.models.find((m) => m.provider === provider && m.id === id) || {
      key: `${provider}:${id}`, provider, id, label: label || id, maxOutput: 64000, thinking: 'none', efforts: [], price: null,
    };
  }

  select(key: string) {
    this.selectedKey = key;
    store.set('vgr:model-key', key);
    this.render();
  }

  private render() {
    // One plain dropdown, grouped by provider; only providers the visitor has a key for (Anthropic shown before any key).
    const sel = $<HTMLSelectElement>('#model');
    const current = this.model;
    sel.innerHTML = '';
    const providers = (['anthropic', 'openrouter'] as Provider[]).filter((p) => this.has(p) || (p === 'anthropic' && !this.has('openrouter')));
    for (const p of providers) {
      const og = document.createElement('optgroup');
      og.label = p === 'anthropic' ? 'Anthropic' : 'OpenRouter';
      for (const m of this.models.filter((x) => x.provider === p)) og.appendChild(new Option(m.label, m.key));
      sel.appendChild(og);
    }
    sel.value = current.key;

    // effort + fast mode follow the model
    const saved = store.get('vgr:effort');
    this.effortSel.innerHTML = '';
    if (!current.efforts.length) { this.effortSel.add(new Option('No effort setting', '')); this.effortSel.disabled = true; }
    else {
      this.effortSel.disabled = false;
      for (const e of current.efforts) this.effortSel.add(new Option(`${e} effort`, e));
      this.effortSel.value = saved && current.efforts.includes(saved) ? saved : current.defaultEffort || current.efforts[0];
    }
    $('#fast-row').hidden = !current.fast;
  }
}
