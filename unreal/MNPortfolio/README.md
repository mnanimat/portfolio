# MN Portfolio 3D — Unreal Engine 5.8

Projeto **content-only** (Blueprint, sem C++) para o showroom cyberpunk da moto em Unreal Engine. O scaffold usa Python somente no Editor para importar/reconstruir assets; Python não é incluído no aplicativo empacotado.

## Estado deste scaffold

- Unreal Engine 5.8 foi localizada neste notebook em `D:\Unreal Engine\UE_5.8`.
- O arquivo fonte foi localizado em `D:\mn\moto-funcional4-animada-v2.glb` (aproximadamente 72 MB).
- Nenhuma GUI, SDK Android ou instalação foi aberta/executada durante a criação destes arquivos.
- Os `.uasset` e o mapa ainda precisam ser gerados ao executar a automação no Unreal.

## O que a automação prepara

1. Cria ou carrega `/Game/MNPortfolio/Maps/L_MN_Showroom`.
2. Importa o GLB como **cena** com Interchange para preservar transformações.
3. Identifica atores com malha, separa containers com vários `StaticMeshComponent` e marca cada peça com `MN_BIKE_PART`.
4. Grava posição montada e posição-alvo em tags `MN_BASE:` e `MN_TARGET:`. Assim os comandos de explosão são reversíveis e não dependem de estado em memória.
5. Cria piso, trilhos de neon, luzes cyan/magenta, pós-processo e materiais emissivos.
6. Cria `WBP_MN_HUD`, `BP_MN_ViewerPawn` e `BP_MN_GameMode` como assets Blueprint content-only.
7. Configura câmera em `SpringArm`, câmera, HUD e órbita automática de apresentação.
8. Expõe `ExplosionAmount`, `ExplosionDistance` e `BikeCenter` no Pawn para completar/ajustar o controle runtime.

A reconstrução apaga somente `/Game/MNPortfolio/Imported/Moto`, assets gerados com os mesmos nomes e atores marcados `MN_GENERATED`/`MN_BIKE_PART` no mapa do projeto.

## Primeira geração, sem abrir GUI

No PowerShell, nesta pasta:

```powershell
.\Scripts\Validate-Unreal.ps1
.\Scripts\Build-EditorAssets.ps1
```

Os dois scripts passam `-DDC-ForceMemoryCache` ao `UnrealEditor-Cmd.exe`. Esse fallback permite que a automação headless continue com cache em memória quando o DDC/Zen padrão não possui um local gravável (por exemplo, em uma execução restrita sem acesso ao `AppData`).

Para usar outro GLB:

```powershell
$env:MN_MOTO_GLB = 'D:\caminho\outra-moto.glb'
.\Scripts\Build-EditorAssets.ps1
```

O comando headless escreve o log em `Saved\Logs\MNPortfolio.log`. Depois, se quiser abrir o Editor explicitamente:

```powershell
.\Scripts\Open-Editor.ps1
```

No Editor, use `Tools > MN Portfolio` para reconstruir, validar, montar, explodir a moto em 50%/100% e mudar a câmera do viewport.

## Empacotamento

Gere os assets antes de empacotar.

Windows Shipping:

```powershell
.\Scripts\Package-Win64.ps1
```

Saída: `Packaged\Win64`.

Android ASTC:

```powershell
.\Scripts\Package-Android.ps1
```

Saída: `Packaged\Android`. O script Android exige `ANDROID_HOME` válido e **não instala** JDK, SDK ou NDK. Use o Turnkey fornecido pela Unreal 5.8 e aceite as licenças diretamente no fluxo oficial antes de tentar o pacote.

Os dois scripts de pacote encaminham o mesmo fallback ao processo de cook por `-AdditionalCookerOptions=-DDC-ForceMemoryCache`; passar a opção diretamente ao `RunUAT` não a encaminharia ao `UnrealEditor-Cmd.exe` iniciado pelo cooker.

## Controles e UI

`DefaultInput.ini` reserva:

- RMB + Mouse X/Y: órbita;
- roda: zoom;
- Q/E: valor de explosão;
- 1/2/3/4: frontal, lateral, traseira e isométrica;
- R: reset;
- H: mostrar/ocultar UI.

O HUD cyberpunk informa esses controles, WhatsApp `+55 75 98232-1124` e `mnanimat@gmail.com`. Ele usa Roboto da instalação da Unreal; os créditos estão em `Licenses/THIRD_PARTY_NOTICES.md`.

## Limitações reais antes de produção

- `-DDC-ForceMemoryCache` é um fallback para ambientes restritos, não um cache persistente. Quando acionado, os dados derivados são descartados ao fim do processo, o uso de RAM pode aumentar e builds posteriores podem recompilar shaders/assets. Para empacotamento frequente, configure um DDC persistente em um caminho gravável.
- A explosão e as vistas funcionam no **Editor** pelos comandos Python. O Blueprint gerado contém as variáveis e os Input Mappings, mas o grafo runtime que conecta Q/E, slider/touch e movimentação das peças ainda precisa ser criado/testado no Editor antes do pacote final. Python de Editor não pode substituir essa lógica no jogo cozido.
- A órbita automática e o HUD são gerados como componentes; enquadramento, escala de UI e câmera precisam ser revisados após ver o tamanho/unidade efetiva do GLB.
- Containers com vários `StaticMeshComponent` são separados automaticamente. Peças esqueléticas ou geometria consolidada em uma única malha não podem ser explodidas internamente sem separar a origem no Blender.
- O alvo Android está preparado para ARM64, ASTC e API 35, mas o pacote depende da versão de SDK/NDK suportada pela instalação 5.8 e do aparelho de teste.
- Este scaffold não inclui a luta Rain/Snow, assets do Blender, software de modelagem/animação ou suas licenças; não é correto inventar créditos sem a URL/arquivo de licença dos modelos exatos.
- O GLB fica fora do repositório, e os assets importados são ignorados pelo `.gitignore`. Cada máquina deve reconstruí-los ou remover essa regra e versionar os `.uasset` conscientemente.

## Checklist de aceite no Editor

1. `Output Log` sem erros `MNPortfolio`/`Interchange`.
2. Moto montada em 0%, sem peças duplicadas visíveis.
3. 50% e 100% movem todas as peças esperadas e 0% restaura exatamente.
4. PIE usa `BP_MN_GameMode`, possui `BP_MN_ViewerPawn`, mostra HUD e enquadra a moto.
5. `Project Launcher` conclui Cook de Win64.
6. Android: `Platforms > Android` mostra SDK válido antes do BuildCookRun.
