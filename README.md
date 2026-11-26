# API de Ocorrências de Manutenção

Projeto de API REST do **Caso 05A — Manutenção: ocorrências em rede de unidades**, desenvolvido a partir do formulário da dupla e do catálogo de estudos de caso enviados na atividade.

A API organiza o fluxo de abertura, triagem, atribuição, atendimento técnico, pausa, confirmação pela unidade e reabertura de ocorrências. As permissões são verificadas no servidor, considerando o perfil do usuário e as unidades às quais ele tem acesso.

## 1. O que está implementado

- Cadastro e consulta de ocorrências de manutenção.
- Identificação de possíveis duplicidades, com confirmação do supervisor e validação de unidade e local.
- Definição de prioridade e atribuição de técnico.
- Registro de diagnóstico, solução e data do atendimento.
- Registro de pausas e retomadas, mantendo os horários para cálculo dos indicadores.
- Encaminhamento para confirmação da unidade, aceite e reabertura.
- Histórico de ações com o usuário responsável por cada alteração.
- Indicadores de tempo em atendimento, tempo pausado e quantidade de reaberturas.
- Controle de acesso por perfil e unidade, incluindo restrição de anexos internos para usuários terceirizados.
- Especificação OpenAPI e coleção Postman importável.

## 2. Requisitos para executar

- Node.js **22.5 ou superior**.
- npm, instalado junto com o Node.js.

O projeto utiliza os módulos nativos do Node.js e o SQLite integrado em `node:sqlite`. A única dependência externa é o `swagger-ui-dist`, usado para exibir o Swagger UI; ela é instalada com `npm install`. O Node pode exibir um aviso de que `node:sqlite` ainda é experimental; isso é esperado nessa versão da plataforma.

Confira a versão instalada:

```bash
node --version
npm --version
```

## 3. Como iniciar

No terminal, dentro da pasta do projeto:

```bash
npm install
```

Copie `.env.example` para `.env`. No Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Depois, inicie a API:

```bash
npm start
```

A primeira execução cria o banco em `.data/ocorrencias.sqlite` e cadastra as unidades e contas de demonstração. A API fica disponível em `http://localhost:3000`. A especificação OpenAPI está em `docs/openapi.json`; o projeto também mantém uma cópia de segurança em `src/openapi.json` para evitar que a API deixe de iniciar caso a pasta `docs` seja extraída incompletamente.

Endereços úteis:

| Recurso | Endereço |
|---|---|
| **Interface web (front-end)** | `http://localhost:3000/` |
| Verificação da API | `http://localhost:3000/health` |
| Informações da API (JSON) | `http://localhost:3000/api` |
| **Swagger UI (documentação interativa)** | `http://localhost:3000/docs` |
| Contrato OpenAPI | `http://localhost:3000/openapi.json` |

Para desenvolvimento com reinicialização automática:

```bash
npm run dev
```

### Swagger UI

Com a API rodando, abra **http://localhost:3000/docs**. A página lista todos os endpoints, agrupados por tag, e permite testá-los pelo botão **Try it out**.

Para testar rotas protegidas:

1. Em `POST /auth/login`, clique em **Try it out** e **Execute** (o exemplo já traz `solicitante@demo.local` / `Demo@123`).
2. Copie o valor de `token` da resposta.
3. Clique em **Authorize** (topo da página), cole o token **sem** a palavra `Bearer` e confirme.
4. Execute as demais rotas. O token fica salvo no navegador entre recargas.

O Swagger UI lê o contrato em `/openapi.json` e envia as requisições para o mesmo host e porta da página.

### Interface web

Com a API rodando, abra **http://localhost:3000/** no navegador. O front-end (HTML, CSS e JavaScript puros, sem dependências) é servido pela própria API a partir de `src/public/`, então não há CORS nem segundo servidor para iniciar.

- Tela de login com botões de acesso rápido para as cinco contas de demonstração.
- Lista de ocorrências com filtros por status e prioridade, e paginação.
- Cadastro de ocorrência e tela de detalhes com dados, indicadores, atendimentos, relacionadas, anexos e histórico.
- Os botões de ação aparecem conforme o perfil e o status (definir prioridade, atribuir técnico, relacionar duplicada, registrar atendimento, pausar/retomar, finalizar, confirmar/recusar, reabrir e anexar). As regras continuam sendo validadas no servidor; mensagens de erro da API são exibidas na tela.

Para rodar o roteiro da prova de ponta a ponta (com a API iniciada em outro terminal): `npm run prova`. Ele executa os casos CT01 a CT10 e imprime `OK`/`FAIL` para cada status esperado.

## 4. Contas para demonstração

Todas as contas abaixo usam a senha `Demo@123`. Elas são dados locais de exemplo; não reutilize essas credenciais em produção.

| Perfil | E-mail | Escopo |
|---|---|---|
| Solicitante | `solicitante@demo.local` | Unidade Ceres |
| Supervisor | `supervisor@demo.local` | As cinco unidades cadastradas |
| Técnico interno | `tecnico@demo.local` | Unidade Ceres |
| Técnico terceirizado | `terceirizado@demo.local` | Unidade Ceres; não recebe anexos `UNIT_ONLY` |
| Responsável da unidade | `responsavel@demo.local` | Unidade Ceres |

As unidades de demonstração são Ceres (ID 1), Rialma (ID 2), Uruana (ID 3), Goiânia (ID 4) e Anápolis (ID 5).

## 5. Autenticação

Faça login em `POST /api/v1/auth/login`:

```json
{
  "email": "solicitante@demo.local",
  "password": "Demo@123"
}
```

A resposta contém um token JWT. Envie-o nas rotas protegidas:

```http
Authorization: Bearer SEU_TOKEN
```

O endpoint `GET /api/v1/auth/me` retorna o perfil e as unidades liberadas ao usuário autenticado.

## 6. Exemplo: abrir uma ocorrência

```http
POST /api/v1/ocorrencias
Content-Type: application/json
Authorization: Bearer SEU_TOKEN
```

```json
{
  "unitId": 1,
  "description": "Queda de energia no bloco administrativo.",
  "location": "Prédio Administrativo",
  "occurredAt": "2026-11-25T14:30:00.000Z",
  "category": "ELÉTRICA"
}
```

A API retorna `201 Created` e inicia a ocorrência com status `ABERTA`. O campo `occurredAt` deve conter uma data ISO 8601 válida e não futura.

## 7. Endpoints por regra de negócio

As rotas usam o prefixo `/api/v1`.

| Regra | Operação principal | Perfil com permissão | Teste |
|---|---|---|---|
| RN1 — Cadastro | `POST /ocorrencias` | Solicitante, supervisor ou responsável | CT01 |
| RN2 — Duplicidade | `POST /ocorrencias/{id}/relacionadas` | Supervisor | CT02 |
| RN3 — Prioridade | `PATCH /ocorrencias/{id}/prioridade` | Supervisor | CT03 |
| RN4 — Atribuição | `PUT /ocorrencias/{id}/atribuicao` | Supervisor | CT04 |
| RN5 — Registro do serviço | `POST /ocorrencias/{id}/atendimentos` | Técnico atribuído | CT06 |
| RN6 — Pausa | `POST /ocorrencias/{id}/pausas` e `POST /ocorrencias/{id}/retomadas` | Técnico atribuído ou supervisor | CT07 |
| RN7 — Finalização | `POST /ocorrencias/{id}/finalizacao` | Técnico atribuído | CT08 |
| RN8 — Confirmação da unidade | `POST /ocorrencias/{id}/confirmacoes` | Responsável da unidade | CT09 |
| RN9 — Reabertura | `POST /ocorrencias/{id}/reaberturas` | Responsável da unidade ou supervisor | CT10 |
| RN10 — Acesso | `GET /ocorrencias`, `GET /ocorrencias/{id}` e `GET /ocorrencias/{id}/anexos` | Usuário autenticado com escopo adequado | CT05 |

A documentação detalhada de parâmetros, corpos e respostas está no arquivo `docs/openapi.json`.

## 8. Como executar os testes automatizados

Com a API parada, execute:

```bash
npm test
```

Os testes usam `node:test`, `fetch` e um banco SQLite em memória. Não alteram o banco de dados local em `.data`. A suíte percorre o fluxo principal e verifica as regras RN1 a RN10, incluindo falhas de validação, conflitos de negócio e tentativas de acesso sem autorização.

A evidência da execução realizada durante a montagem do projeto está em `docs/evidencias/testes-automatizados.txt`.

## 9. Como executar a coleção Postman

1. Inicie a API com `npm start`.
2. No Postman, importe `postman/colecao-api-ocorrencias.postman_collection.json`.
3. Importe e selecione `postman/ambiente-local.postman_environment.json`.
4. Confira se `baseUrl` está como `http://localhost:3000/api/v1`.
5. Execute os requests na ordem apresentada, usando o Collection Runner.

Os requests de autenticação salvam os tokens no ambiente. Os testes também guardam os IDs criados ao longo da execução. A coleção foi organizada para ser executada do início ao fim; não pule os requests de preparação.

A coleção cria registros no banco local. Para repetir o fluxo do zero, pare a API e execute:

```bash
npm run db:reset
```

**Atenção:** esse comando apaga o banco local e recria os dados de demonstração. Não o execute se quiser manter ocorrências que você cadastrou manualmente.

## 10. Estrutura de pastas

```text
src/
  public/                      # Front-end: index.html, style.css, app.js
  app.js                       # Tratamento HTTP, arquivos estáticos e documentação
  server.js                    # Inicialização e encerramento do servidor
  config/env.js                # Leitura das configurações locais
  db/                          # Conexão SQLite, schema, seed e reset
  http/router.js               # Leitura HTTP, rotas, autenticação e validação do token
  routes/register.js           # Endpoints de autenticação, catálogo e ocorrências
  services/occurrence.service.js # Regras compartilhadas, histórico e indicadores
  utils/                       # Validação, segurança e erros HTTP

scripts/
  roteiro-prova.js             # Roteiro da prova (CT01–CT10) contra a API em execução

tests/
  api.test.js                  # Testes de integração das RN1 a RN10

docs/
  openapi.json                 # Contrato da API
  guia-do-projeto.md           # Requisitos, histórias, modelagem e rastreabilidade
  decisoes-e-premissas.md      # Decisões adotadas onde o caso deixou margem
  evidencias/                  # Resultado dos testes automatizados
  roteiro-demonstracao.md      # Sequência para apresentação em sala

postman/
  colecao-api-ocorrencias.postman_collection.json
  ambiente-local.postman_environment.json
```

## 11. Decisões e limites conhecidos

- O vínculo com unidade é conferido no servidor em consultas e alterações. Para um registro fora do escopo do usuário, a API responde `404`, sem revelar se o ID existe.
- A atribuição exige que o técnico tenha vínculo com a unidade da ocorrência. A conta terceirizada de demonstração tem acesso somente à Unidade Ceres.
- Anexos são representados por metadados e nível de visibilidade. O projeto ainda não implementa upload nem armazenamento dos arquivos binários.
- O tempo de atendimento é calculado pela linha do tempo de status. Períodos `PAUSADA` e `ENCERRADA` são excluídos do tempo ativo. O tempo aguardando confirmação está incluído até a unidade aceitar ou recusar.
- Os registros e contas iniciais são adequados para demonstração acadêmica. Antes de uso real, devem ser definidos política de senha, gerenciamento de usuários, armazenamento de arquivos, cópias de segurança, monitoramento e configuração de produção.

> Observação: as pastas `docs/` e `postman/` citadas acima não vieram no pacote recebido. A API não depende delas (usa a cópia `src/openapi.json`).

#   s i s t e m a - m a n u t e n c a o  
 