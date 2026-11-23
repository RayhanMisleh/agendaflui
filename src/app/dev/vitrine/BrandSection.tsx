import type { ReactNode } from 'react'

/** Cores da marca com o nome do manual e o uso. O quadrado usa o token, então muda com a conta e com o tema. */
const COLORS: ReadonlyArray<{ token: string; name: string; use: string }> = [
  { token: '--brand', name: 'Água', use: 'Ação: botão principal, link, item ativo, blocos da agenda.' },
  { token: '--brand-strong', name: 'Água forte', use: 'Passar o mouse e pressionar.' },
  { token: '--brand-tint', name: 'Bolha', use: 'Horário livre, escolhido, destaque suave.' },
  { token: '--accent', name: 'Caramelo', use: 'O horário marcado e o que pede atenção. Nunca é cor de texto.' },
  { token: '--accent-tint', name: 'Mel', use: 'Avisos amigáveis e lembretes.' },
  { token: '--ground', name: 'Espuma', use: 'Fundo da página.' },
  { token: '--surface', name: 'Superfície', use: 'Cartões, painéis e folhas.' },
  { token: '--ink', name: 'Tinta', use: 'Texto.' },
  { token: '--ink-muted', name: 'Tinta suave', use: 'Texto secundário.' },
  { token: '--line', name: 'Linha', use: 'Bordas e grade.' },
  { token: '--success', name: 'Sucesso', use: 'Só estado.' },
  { token: '--danger', name: 'Erro', use: 'Só estado.' },
]

const SCALE: ReadonlyArray<{ cls: string; label: string; sample: string }> = [
  { cls: 'af-display', label: 'Título grande · 64', sample: 'Banho marcado, cliente tranquilo.' },
  { cls: 'af-h1', label: 'Título 1 · 44', sample: 'Sua agenda enche sozinha.' },
  { cls: 'af-h2', label: 'Título 2 · 32', sample: 'Do link na bio ao pet cheiroso' },
  { cls: 'af-h3', label: 'Título 3 · 22', sample: 'Monte seus serviços' },
  { cls: 'vt-body-lg', label: 'Texto grande · 19', sample: 'O cliente escolhe o serviço e o horário pelo seu link, sem ligar.' },
  { cls: 'vt-body', label: 'Texto · 16', sample: 'Lembrete automático na véspera, com botão para confirmar ou remarcar.' },
  { cls: 'vt-small', label: 'Texto pequeno · 14', sample: 'Sem instalar nada. Funciona no celular do cliente e no computador do balcão.' },
]

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="vt-block">
      <h3 className="vt-h3">{title}</h3>
      {children}
    </div>
  )
}

export function BrandSection({ night }: { night: boolean }) {
  return (
    <section aria-labelledby="vt-marca" className="vt-section">
      <h2 id="vt-marca" className="af-h2 vt-h2">
        A marca
      </h2>
      <p className="vt-lead">A agenda que flui: água para agir, caramelo para o horário marcado, tinta para ler.</p>

      <Block title="Logo">
        <div className="vt-logos">
          {night ? (
            <>
              <div className="vt-logo">
                {/* eslint-disable-next-line @next/next/no-img-element -- arquivo estático da marca */}
                <img src="/brand/agendaflui-horizontal-negativo.svg" alt="Agenda Flui, versão para fundo escuro" height={40} />
              </div>
              <p className="vt-note">No tema noite a marca usa a versão em negativo, sobre fundo escuro.</p>
            </>
          ) : (
            <>
              <div className="vt-logo">
                {/* eslint-disable-next-line @next/next/no-img-element -- arquivo estático da marca */}
                <img src="/brand/agendaflui-horizontal.svg" alt="Agenda Flui" height={40} />
              </div>
              <div className="vt-logo vt-logo--brand">
                {/* eslint-disable-next-line @next/next/no-img-element -- arquivo estático da marca */}
                <img src="/brand/agendaflui-horizontal-negativo.svg" alt="Agenda Flui, versão para fundo colorido" height={40} />
              </div>
              <div className="vt-logo">
                {/* eslint-disable-next-line @next/next/no-img-element -- arquivo estático da marca */}
                <img src="/brand/agendaflui-simbolo.svg" alt="Símbolo da Agenda Flui" height={48} />
              </div>
            </>
          )}
        </div>
      </Block>

      <Block title="Cores">
        <ul className="vt-colors">
          {COLORS.map((c) => (
            <li key={c.token} className="vt-color">
              <span className="vt-color__swatch" style={{ backgroundColor: `var(${c.token})` }} aria-hidden="true" />
              <span className="vt-color__text">
                <strong>{c.name}</strong>
                <code>{c.token}</code>
                <span>{c.use}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="vt-note">
          Em cada tela: 70% espuma e branco, 20% tinta, 8% água, 2% caramelo. O caramelo é raro de propósito.
        </p>
      </Block>

      <Block title="Fontes">
        <p className="vt-note">
          Bricolage Grotesque 700 nos títulos e nos números grandes. Figtree 400, 600 e 700 no texto e na interface.
          Horários e números levam algarismos tabulares.
        </p>
        <div className="vt-scale">
          {SCALE.map((s) => (
            <div key={s.cls} className="vt-scale__row">
              <span className="vt-scale__label">{s.label}</span>
              <p className={s.cls}>{s.sample}</p>
            </div>
          ))}
          <div className="vt-scale__row">
            <span className="vt-scale__label">Números · tabulares</span>
            <p className="vt-numbers">09:00 10:30 14:00 · R$ 1.234,50</p>
          </div>
        </div>
      </Block>
    </section>
  )
}
