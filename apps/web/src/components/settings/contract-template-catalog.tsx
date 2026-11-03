'use client';

import { useTranslations } from 'next-intl';
import {
  TEMPLATE_BLOCKS,
  TEMPLATE_LIST_NAMES,
  TEMPLATE_LISTS,
  TEMPLATE_LIST_SUMMARIES,
  TEMPLATE_LOOP_FIELDS,
  TEMPLATE_PERSON_PREFIXES,
  TEMPLATE_VARIABLE_GROUPS,
} from '@realfy/shared';
import { listBlock, personFieldsFor, variableMessageKey } from '@/lib/contract-template-catalog';

interface Props {
  /** Recibe el texto a poner en el cuerpo, en la posición del cursor. */
  onInsert: (text: string) => void;
}

const token = (name: string) => `{{${name}}}`;

function Chip({ text, title, onInsert }: { text: string; title: string; onInsert: (text: string) => void }) {
  return (
    <button
      type="button"
      title={title}
      onClick={() => onInsert(token(text))}
      className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-left font-mono text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-sunken)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500"
    >
      {token(text)}
    </button>
  );
}

/** Catálogo de lo que una plantilla puede usar: variables con su descripción, listas y bloques. */
export function ContractTemplateCatalog({ onInsert }: Props) {
  const t = useTranslations('contractTemplates.catalog');
  const insertToken = (name: string) => onInsert(token(name));

  return (
    <aside aria-label={t('title')} className="space-y-5 text-sm">
      <div>
        <h3 className="text-base font-semibold text-[var(--color-text)]">{t('title')}</h3>
        <p className="mt-1 text-[var(--color-muted)]">{t('intro')}</p>
      </div>

      <section aria-labelledby="cat-vars" className="space-y-3">
        <h4 id="cat-vars" className="font-semibold text-[var(--color-text)]">
          {t('variablesTitle')}
        </h4>
        {TEMPLATE_VARIABLE_GROUPS.map((group) => (
          <details key={group.id} className="rounded-lg border border-[var(--color-border)]">
            <summary className="cursor-pointer px-3 py-2 font-medium text-[var(--color-text)]">{t(`groups.${group.id}`)}</summary>
            <ul className="divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
              {group.variables.map((name) => (
                <li key={name} className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-start sm:gap-3">
                  <button
                    type="button"
                    aria-label={`${t('insert')} ${token(name)}`}
                    onClick={() => insertToken(name)}
                    className="shrink-0 rounded-md border border-[var(--color-border)] px-2 py-1 text-left font-mono text-xs hover:bg-[var(--color-surface-sunken)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500"
                  >
                    {token(name)}
                  </button>
                  <span className="text-[var(--color-muted)]">{t(`vars.${variableMessageKey(name)}`)}</span>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </section>

      <section aria-labelledby="cat-people" className="space-y-3">
        <h4 id="cat-people" className="font-semibold text-[var(--color-text)]">
          {t('personsTitle')}
        </h4>
        <p className="text-[var(--color-muted)]">{t('personsHint')}</p>
        {TEMPLATE_PERSON_PREFIXES.map((prefix) => (
          <details key={prefix} className="rounded-lg border border-[var(--color-border)]">
            <summary className="cursor-pointer px-3 py-2 font-mono text-[var(--color-text)]">{prefix}</summary>
            <div className="space-y-2 border-t border-[var(--color-border)] px-3 py-2">
              <p className="text-[var(--color-muted)]">{t(`prefixes.${prefix}`)}</p>
              <div className="flex flex-wrap gap-1.5">
                {personFieldsFor(prefix).map((field) => (
                  <Chip key={field} text={`${prefix}.${field}`} title={t(`fields.${field}`)} onInsert={onInsert} />
                ))}
              </div>
            </div>
          </details>
        ))}
      </section>

      <section aria-labelledby="cat-lists" className="space-y-3">
        <h4 id="cat-lists" className="font-semibold text-[var(--color-text)]">
          {t('listsTitle')}
        </h4>
        <p className="text-[var(--color-muted)]">{t('listsHint')}</p>
        {TEMPLATE_LIST_NAMES.map((list) => (
          <details key={list} className="rounded-lg border border-[var(--color-border)]">
            <summary className="cursor-pointer px-3 py-2 font-mono text-[var(--color-text)]">{list}</summary>
            <div className="space-y-2 border-t border-[var(--color-border)] px-3 py-2">
              <p className="text-[var(--color-muted)]">{t(`lists.${list}`)}</p>
              <button
                type="button"
                onClick={() => onInsert(listBlock(list))}
                className="rounded-md border border-brand-500 px-2 py-1 text-xs font-medium text-brand-600 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500"
              >
                {t('insertBlock')}: {list}
              </button>
              <div className="flex flex-wrap gap-1.5">
                {TEMPLATE_LISTS[list].map((field) => (
                  <Chip key={field} text={`item.${field}`} title={t(`fields.${field}`)} onInsert={onInsert} />
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {TEMPLATE_LIST_SUMMARIES.map((summary) => (
                  <Chip key={summary} text={`${list}.${summary}`} title={t(`summaries.${summary}`)} onInsert={onInsert} />
                ))}
              </div>
            </div>
          </details>
        ))}
        <details className="rounded-lg border border-[var(--color-border)]">
          <summary className="cursor-pointer px-3 py-2 font-medium text-[var(--color-text)]">{t('loopTitle')}</summary>
          <ul className="space-y-2 border-t border-[var(--color-border)] px-3 py-2">
            {TEMPLATE_LOOP_FIELDS.map((field) => (
              <li key={field} className="flex flex-col gap-1 sm:flex-row sm:gap-3">
                <Chip text={`item.${field}`} title={t(`loop.${field}`)} onInsert={onInsert} />
                <span className="text-[var(--color-muted)]">{t(`loop.${field}`)}</span>
              </li>
            ))}
          </ul>
        </details>
      </section>

      <section aria-labelledby="cat-blocks" className="space-y-3">
        <h4 id="cat-blocks" className="font-semibold text-[var(--color-text)]">
          {t('blocksTitle')}
        </h4>
        {TEMPLATE_BLOCKS.map((block) => (
          <div key={block.id} className="space-y-1.5 rounded-lg border border-[var(--color-border)] px-3 py-2">
            <p className="font-medium text-[var(--color-text)]">{t(`blocks.${block.id}.title`)}</p>
            <p className="text-[var(--color-muted)]">{t(`blocks.${block.id}.description`)}</p>
            <pre className="overflow-x-auto rounded-md bg-[var(--color-surface-sunken)] p-2 font-mono text-xs whitespace-pre-wrap">{block.example}</pre>
            <button
              type="button"
              aria-label={`${t('insert')}: ${t(`blocks.${block.id}.title`)}`}
              onClick={() => onInsert(block.example)}
              className="rounded-md border border-brand-500 px-2 py-1 text-xs font-medium text-brand-600 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500"
            >
              {t('insert')}
            </button>
          </div>
        ))}
      </section>

      <section aria-labelledby="cat-format" className="space-y-1.5">
        <h4 id="cat-format" className="font-semibold text-[var(--color-text)]">
          {t('formatTitle')}
        </h4>
        <p className="text-[var(--color-muted)]">{t('formatBold')}</p>
        <p className="text-[var(--color-muted)]">{t('formatHeading')}</p>
      </section>
    </aside>
  );
}
