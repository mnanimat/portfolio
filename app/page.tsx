import FightLab from "./components/FightLab";
import MotionForge from "./components/MotionForge";
import MotoViewer from "./components/MotoViewer";
import PwaInstall from "./components/PwaInstall";
import QuoteStudio from "./components/QuoteStudio";

const navItems = [
  ["Moto 3D", "#moto"],
  ["Fight Lab", "#fight"],
  ["Motion Forge", "#forge"],
  ["Edição", "#edicao"],
  ["Créditos", "#creditos"],
];

export default function Home() {
  return (
    <main className="site-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="MN Animation — início">
          <span className="brand__mark">MN</span>
          <span className="brand__name">ANIMATION<small>3D · MOTION · FILM</small></span>
        </a>
        <nav aria-label="Navegação principal">
          {navItems.map(([label, href], index) => <a key={href} href={href}><span>0{index + 1}</span>{label}</a>)}
        </nav>
        <a className="topbar__cta" href="#edicao">Iniciar projeto <span>↗</span></a>
      </header>

      <div id="top" className="hero-anchor" />
      <section id="moto" className="hero-section section-grid">
        <div className="hero-copy">
          <div className="status-pill"><span /> SISTEMAS CRIATIVOS ONLINE</div>
          <p className="eyebrow">PORTFÓLIO INTERATIVO / 2026</p>
          <h1>Máquinas<br />em <em>movimento.</em></h1>
          <p className="hero-copy__lead">Modelagem, animação 3D e edição com precisão técnica — da primeira malha ao último frame.</p>
          <div className="hero-actions">
            <a className="primary-button" href="#forge">Abrir Motion Forge <span>↗</span></a>
            <a className="text-link" href="#edicao">Pedir edição de vídeo <span>→</span></a>
          </div>
          <dl className="hero-metrics">
            <div><dt>160</dt><dd>peças animadas</dd></div>
            <div><dt>3.19<span>MB</span></dt><dd>GLB otimizado</dd></div>
            <div><dt>UE<span>5.8</span></dt><dd>pipeline desktop</dd></div>
          </dl>
        </div>
        <div className="hero-viewer-wrap">
          <div className="hero-viewer__corner hero-viewer__corner--a" />
          <div className="hero-viewer__corner hero-viewer__corner--b" />
          <MotoViewer />
          <span className="hero-viewer__caption">MODELO ORIGINAL · MN ANIMATION</span>
        </div>
        <div className="hero-rail"><span>SCROLL TO EXPLORE</span><i /></div>
      </section>

      <div className="kinetic-strip" aria-hidden="true">
        <div>MODELAGEM 3D <span>✦</span> ANIMAÇÃO <span>✦</span> UNREAL ENGINE <span>✦</span> EDIÇÃO DE VÍDEO <span>✦</span> MODELAGEM 3D <span>✦</span> ANIMAÇÃO <span>✦</span></div>
      </div>

      <section id="fight" className="content-section fight-section">
        <div className="section-heading section-heading--split">
          <div><p className="eyebrow">02 / COREOGRAFIA</p><h2>Fight <em>Lab</em></h2></div>
          <p>Uma luta pensada por poses-chave, ritmo, peso e leitura de silhueta. Arraste a câmera, controle o tempo e inspecione a coreografia.</p>
        </div>
        <FightLab />
      </section>

      <section id="forge" className="content-section forge-section">
        <div className="section-heading section-heading--split">
          <div><p className="eyebrow">03 / SOFTWARE AUTORAL</p><h2>Motion <em>Forge</em></h2></div>
          <div className="section-heading__meta"><span>WEBGL</span><span>KEYFRAMES</span><span>GLTF</span><span>AUTORAL</span></div>
        </div>
        <div className="forge-intro">
          <p>Um laboratório de criação 3D independente, inspirado por fluxos profissionais — sem copiar interfaces ou código de terceiros.</p>
          <div><strong>MODEL</strong><strong>ANIMATE</strong><strong>BALANCE</strong><strong>EXPORT</strong></div>
        </div>
        <MotionForge />
      </section>

      <section id="edicao" className="content-section quote-section">
        <div className="section-heading section-heading--split">
          <div><p className="eyebrow">04 / SEU PROJETO</p><h2>Do clipe ao <em>impacto.</em></h2></div>
          <p>Personalize o briefing, organize seus vídeos e fale direto com quem vai editar. Sem formulários genéricos e sem preço escondido atrás de cadastro.</p>
        </div>
        <QuoteStudio />
      </section>

      <section className="platform-section content-section" aria-labelledby="platform-title">
        <div className="platform-copy"><p className="eyebrow">05 / MULTIPLATAFORMA</p><h2 id="platform-title">Uma cena.<br /><em>Três destinos.</em></h2><p>A mesma linguagem visual preparada para navegador, aplicativo Windows em Unreal Engine e interface mobile responsiva.</p></div>
        <div className="platform-stack">
          <article><span>01</span><div><small>WEB / REALTIME</small><h3>Portfolio Experience</h3><p>Three.js, GLB otimizado, interação por mouse, teclado e toque.</p></div><b>ONLINE</b></article>
          <article><span>02</span><div><small>WINDOWS / UE 5.8</small><h3>MN Portfolio App</h3><p>Projeto content-only com importação automatizada e cena cyberpunk.</p></div><b>PIPELINE</b></article>
          <article><span>03</span><div><small>MOBILE / ANDROID</small><h3>Touch Edition</h3><p>Layout e controles preparados; empacotamento depende do SDK/NDK local.</p></div><b>PREPARADO</b></article>
        </div>
      </section>

      <section id="creditos" className="credits-section content-section">
        <div className="section-heading"><p className="eyebrow">06 / CRÉDITOS & LICENÇAS</p><h2>Criação com <em>procedência.</em></h2></div>
        <div className="credits-grid">
          <article><span className="credit-tag">CC BY 4.0</span><h3>Rain Rig</h3><p>Rain Rig (CC) Blender Foundation | studio.blender.org</p><p className="credit-change">Alterações previstas: conversão/otimização para Unreal Engine, ajustes de materiais e animação original de luta por MN Animation.</p><a href="https://studio.blender.org/characters/rain/" target="_blank" rel="noreferrer">Fonte oficial ↗</a></article>
          <article><span className="credit-tag">CC BY 4.0</span><h3>Snow Rig</h3><p>Snow Rig (CC) Blender Foundation | studio.blender.org</p><p className="credit-change">Alterações previstas: conversão/otimização para Unreal Engine, ajustes de materiais e animação original de luta por MN Animation.</p><a href="https://studio.blender.org/characters/snow/" target="_blank" rel="noreferrer">Fonte oficial ↗</a></article>
          <article><span className="credit-tag credit-tag--mn">ORIGINAL</span><h3>Moto & experiência</h3><p>Modelo, animação de explosão, direção visual e portfólio por MN Animation.</p><p className="credit-change">Tipografia Geist e Geist Mono, distribuídas sob SIL Open Font License.</p><a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">Ver licença CC BY 4.0 ↗</a></article>
        </div>
      </section>

      <section className="contact-banner">
        <div><span className="eyebrow">PRONTO PARA O PRÓXIMO FRAME?</span><h2>Vamos tornar sua ideia <em>visível.</em></h2></div>
        <div className="contact-banner__actions"><a href="https://wa.me/5575982321124" target="_blank" rel="noreferrer">WhatsApp <span>↗</span></a><a href="mailto:mnanimat@gmail.com">E-mail <span>↗</span></a></div>
      </section>

      <footer>
        <a className="brand" href="#top"><span className="brand__mark">MN</span><span className="brand__name">ANIMATION<small>MAKE MOTION MATTER</small></span></a>
        <p>© 2026 MN Animation. Portfólio e software autoral.</p>
        <div><a href="#moto">Topo ↑</a><a href="mailto:mnanimat@gmail.com">mnanimat@gmail.com</a></div>
      </footer>

      <a className="floating-whatsapp" href="https://wa.me/5575982321124" target="_blank" rel="noreferrer" aria-label="Falar com MN Animation pelo WhatsApp">WA<span>Orçamento</span></a>
      <PwaInstall />
    </main>
  );
}
