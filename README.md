# 🚀 UnRepo API Server

<div align="center">

**Standalone Express.js REST API for AI-powered GitHub repository analysis and intelligent chatbot**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)
[![Express](https://img.shields.io/badge/Express-4.22-lightgrey)](https://expressjs.com/)

</div>

---

## ✨ Features

- **🤖 AI-Powered Chatbot** - Intelligent code analysis using Claude & ChatGPT
- **🔍 Repository Research** - Deep GitHub repository analysis and insights
- **🔐 JWT Authentication** - Secure token-based authentication system
- **🔑 API Key Management** - Generate and manage chatbot & research API keys
- **⚡ Rate Limiting** - Free tier (5 calls) & Premium tier (unlimited)
- **🗄️ PostgreSQL Database** - Robust data persistence with Prisma ORM
- **📊 Usage Analytics** - Track API usage and statistics
- **🌐 CORS Enabled** - Ready for cross-origin requests

---

## 🚀 Quick Start

```bash
# Clone the repository
git clone https://github.com/unrepo-dev/UnRepo-Api.git
cd UnRepo-Api

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env

# Generate Prisma client
npm run prisma:generate

# Run database migrations
npm run prisma:migrate

# Start development server
npm run dev
```

Server starts on `http://localhost:4000`

---

## 🔑 Creating Your First API Key

### Generate Chatbot API Key

```bash
curl -X POST http://localhost:4000/api/keys/generate \
  -H "Content-Type: application/json" \
  -d '{
    "type": "CHATBOT",
    "name": "My Chatbot Key",
    "email": "your-email@example.com"
  }'
```

### Generate Research API Key

```bash
curl -X POST http://localhost:4000/api/keys/generate \
  -H "Content-Type: application/json" \
  -d '{
    "type": "RESEARCH",
    "name": "My Research Key",
    "email": "your-email@example.com"
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "API key created successfully",
  "data": {
    "apiKey": "unrepo_chatbot_abc123...",
    "type": "CHATBOT",
    "name": "My Chatbot Key",
    "usageCount": 0
  }
}
```

⚠️ **Save your API key - it's shown only once!**

---

## 📡 API Endpoints

### Chatbot API
**Endpoint:** `POST /api/v1/chatbot`

**Headers:**
```
x-api-key: unrepo_chatbot_[your_key]
Content-Type: application/json
```

**Request:**
```json
{
  "message": "Explain this function",
  "repoUrl": "https://github.com/vercel/next.js"
}
```

**Rate Limits:** Free: 5 calls | Premium: 200/hour

---

### Research API
**Endpoint:** `POST /api/v1/research`

**Headers:**
```
x-api-key: unrepo_research_[your_key]
Content-Type: application/json
```

**Request:**
```json
{
  "repoUrl": "https://github.com/vercel/next.js"
}
```

**Rate Limits:** Free: 5 calls | Premium: 100/hour

---

## 💻 Usage Examples

### JavaScript/TypeScript

```typescript
const response = await fetch('http://localhost:4000/api/v1/chatbot', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': 'unrepo_chatbot_your_key'
  },
  body: JSON.stringify({
    message: 'What does this code do?',
    repoUrl: 'https://github.com/user/repo'
  })
});

const data = await response.json();
console.log(data.response);
```

### Python

```python
import requests

url = 'http://localhost:4000/api/v1/research'
headers = {
    'Content-Type': 'application/json',
    'x-api-key': 'unrepo_research_your_key'
}
payload = {'repoUrl': 'https://github.com/user/repo'}

response = requests.post(url, json=payload, headers=headers)
print(response.json()['data']['analysis'])
```

### React Integration

```tsx
import { useState } from 'react';

function ChatBot() {
  const [message, setMessage] = useState('');
  const [response, setResponse] = useState('');

  const askAI = async () => {
    const res = await fetch('http://localhost:4000/api/v1/chatbot', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.REACT_APP_UNREPO_API_KEY
      },
      body: JSON.stringify({ message })
    });
    
    const data = await res.json();
    setResponse(data.response);
  };

  return (
    <div>
      <input value={message} onChange={(e) => setMessage(e.target.value)} />
      <button onClick={askAI}>Ask AI</button>
      <p>{response}</p>
    </div>
  );
}
```

---

## 🔧 Environment Variables

```env
PORT=4000
FRONTEND_URL=http://localhost:3000
DATABASE_URL=postgresql://...
JWT_SECRET=your-secret
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GITHUB_TOKEN=ghp_...
REDIS_URL=redis://...
```

---

## 📁 Project Structure

```
Unrepo-Api/
├── server.ts           # Express server
├── routes/
│   ├── chatbot.ts     # Chatbot API
│   └── research.ts    # Research API
├── lib/
│   ├── ai.ts          # AI services
│   ├── github.ts      # GitHub client
│   └── prisma.ts      # Database
├── prisma/
│   └── schema.prisma  # DB schema
└── package.json
```

---

## 🚢 Deployment

### Docker

```bash
docker build -t unrepo-api .
docker run -p 4000:4000 --env-file .env unrepo-api
```

### Vercel

```bash
vercel deploy
```

---

## 📄 License

MIT License - Copyright 2025 UnRepo

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/unrepo-dev/UnRepo-Api/issues)
- **Email**: team@unrepo.dev
- **Website**: [unrepo.dev](https://unrepo.dev)

---

<div align="center">

**Made with ❤️ by UnRepo Team**

[Website](https://unrepo.dev) • [GitHub](https://github.com/unrepo-dev) • [Docs](https://docs.unrepo.dev)

</div>
