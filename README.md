# Sistema de Manutenção

Desenvolvemos este projeto na faculdade usando Node.js e SQLite. A unidade abre um chamado, o supervisor define a prioridade e escolhe o técnico. Depois do atendimento, a unidade confere o serviço e pode encerrar ou reabrir o chamado.

## Como rodar

Com Node.js 22.5 ou superior, execute no PowerShell dentro da pasta do projeto:

```powershell
npm install
Copy-Item .env.example .env
npm start
```

Abra http://localhost:3000 no navegador.
