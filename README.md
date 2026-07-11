# MN Animation — Portfólio Interativo

Experiência web 3D, estúdio de edição de vídeo e protótipo de software de modelagem/animação autoral. O mesmo repositório inclui a preparação de um aplicativo Unreal Engine 5.8 content-only.

## Experiências

- **Moto 3D:** GLB real com 160 peças/animações, seleção por clique, vistas, hotspots, wireframe e explosão sincronizada.
- **Fight Lab:** animática 3D interativa de coreografia Rain × Snow, com créditos CC BY 4.0 e pipeline para substituir a previz pelo render Blender/Unreal.
- **Motion Forge:** viewport, primitivas, transformação, materiais, hierarquia, timeline, keyframes, trajetória, presets, importação e exportação glTF.
- **Video Briefing:** drag-and-drop, ordem dos clipes, briefing criativo, upload R2 e solicitação por WhatsApp/e-mail.
- **Unreal:** projeto e automação em `unreal/MNPortfolio`, sem dependência de código C++.

## Desenvolvimento web

Requisitos: Node.js 22.13 ou mais recente.

```powershell
npm install
npm run dev
npm run build
```

O binding R2 lógico `CLIPS` está declarado em `.openai/hosting.json`. Sem esse binding, a API de upload retorna `503` de forma explícita e não simula que salvou arquivos.

## Modelo da moto

O original permanece fora do repositório em:

`D:\mn\moto-funcional4-animada-v2.glb`

O derivado web/mobile em `public/models/moto-mn-optimized.glb` foi gerado pelo Blender 5.1 com redução geométrica e Draco. Ele preserva os nomes das peças e as 160 ações, reduzindo o arquivo de 72,38 MiB para aproximadamente 3,19 MiB. Para regenerar:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' --background --factory-startup --python 'scripts\optimize_moto.py' -- 'D:\mn\moto-funcional4-animada-v2.glb' 'public\models\moto-mn-optimized.glb'
```

## Créditos Rain e Snow

- Rain Rig (CC) Blender Foundation — <https://studio.blender.org/characters/rain/>
- Snow Rig (CC) Blender Foundation — <https://studio.blender.org/characters/snow/>
- Licença: <https://creativecommons.org/licenses/by/4.0/>

Ao exportar os rigs para Unreal, manter a indicação: “conversão/otimização para Unreal Engine, ajustes de materiais e animação original de luta por MN Animation”. Os `.blend` oficiais não são redistribuídos neste repositório.

## Escopo do Motion Forge

O editor é um produto autoral e extensível, não um clone nem uma reimplementação integral do Blender ou do Cascadeur. A primeira versão cobre o fluxo demonstrável no navegador; escultura avançada, rigging completo, simulação multifísica, graph editor e colaboração multiusuário permanecem módulos futuros.

## Contato

- WhatsApp: [(75) 98232-1124](https://wa.me/5575982321124)
- E-mail: [mnanimat@gmail.com](mailto:mnanimat@gmail.com)
