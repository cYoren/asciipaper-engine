# Estado da unificação — 9 de outubro de 2026

Não foi necessário refazer o ASCII Paper do zero. A mudança reaproveita os shaders, o motor nativo e os hosts existentes, acrescentando um projeto portátil completo e o Studio comum em Windows, Android, macOS, iOS e navegador. Linux continua com o Studio GTK e ganha importação/exportação do mesmo formato.

## Entrega de código

- Passagens de renderização e catálogo de aparências compartilhados; geração verificável dos recursos.
- As 11 cenas integradas ao catálogo editável. Android compila as quatro simulações antigas diretamente do mesmo C usado no Linux.
- Projetos `.asciipaper.json` com shader, aparência e mídia; troca explícita entre plataformas e ferramentas MCP de importação/exportação.
- Studio Android com biblioteca persistente, editor de shader, importação de imagem/GIF/vídeo, texto, códigos de aparência e exportações.
- Android com vídeo via decoder de plataforma/GPU e desenho sob demanda, pausas por visibilidade e limites por bateria/temperatura.
- Targets de iPhone/iPad e macOS com WKWebView, armazenamento nativo, exportação pelo sistema e wallpaper de desktop no macOS.
- CI de compatibilidade e Android, somada aos builds Apple e aos self-tests Windows existentes.
- Correção de um acesso inválido ao liberar a simulação fluid após troca de buffers, verificada com sanitizadores.

## O que “1:1” significa agora

| Recurso | Windows | Linux | Android | macOS/iOS |
|---|---|---|---|---|
| Spec, shader, aparência e projeto completo | Implementado | Implementado | Implementado | Implementado nos novos targets |
| 11 cenas, estilos, formas, dithers e efeitos | Implementado | Implementado | Implementado | Compartilhados pelo Studio/runtime |
| Biblioteca e importação de mídia | Filesystem | Filesystem/ffmpeg | IndexedDB + decoder nativo | Armazenamento nativo + WebKit |
| Wallpaper contínuo do sistema | Host Windows | Wayland com layer-shell | Serviço live wallpaper | macOS: host desktop; iOS: indisponível |
| MCP stdio | Sem host próprio | Existente, com project tools | Sem servidor local | Sem servidor local |
| Exportações | Projeto/HTML/PNG/vídeo + ZIP existente | CLI: projeto/ZIP/imagem/vídeo | Projeto/HTML/PNG; gravação depende do WebView | Projeto/HTML/PNG; gravação depende do WebView |

O formato e a edição comum ficaram unidos; a paridade total de integrações ainda não está concluída. Fontes variam entre sistemas. Android e Apple aceitam links diretos HTTPS; posts do X continuam no importador desktop. Linux mantém sua interface GTK. Autostart, gerência de arquivos, codecs e gravação precisam respeitar as capacidades de cada sistema. Não há sincronização automática de bibliotecas.

## Validação e aceite

Passaram localmente os 14 testes automatizados de formato, recipes, shaders, geração, frame policy, PNG e ciclos das simulações; build Linux e snapshots das 11 cenas; build Android para quatro ABIs e lint; teste Chromium de persistência, captura não vazia e pausa, inclusive depois de recarregar o iframe. No emulador Android API 35, passaram as 11 cenas nativas, decodificação de PNG/GIF/vídeo e pausa ao sair do preview. Os resultados dos builds Windows/Apple são registrados na PR.

Build e testes não comprovam consumo mínimo de energia. O trabalho remove callbacks periódicos quando o wallpaper está oculto e limita a taxa de frames, mas faltam medições comparáveis em aparelhos físicos. macOS/iOS também precisam de testes de WebKit, seleção de arquivos e codecs em hardware Apple.

É possível preparar builds para Google Play e App Store com essa arquitetura. Ainda são necessários conta de desenvolvedor, assinatura/provisionamento, ícones, metadados, declarações de privacidade, testes e aprovação da loja. O target iOS é um editor/exportador, pois o sistema não permite o mesmo wallpaper contínuo de Android. A listagem [ASCII Paper no Glama](https://glama.ai/mcp/servers/cYoren/asciipaper) cobre o diretório MCP; não é aprovação de Google Play ou App Store.

Detalhes de formatos, build e verificação: [shared-runtime.md](shared-runtime.md). O [diagnóstico inicial](platform-unification-assessment.md) fica como registro do ponto de partida.
