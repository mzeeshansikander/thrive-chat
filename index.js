//boiler plate for express
const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const { getZodiacSign } = require("./getZodiacSign");
const app = express();
const port = 3006;
require('dotenv').config();

const { getFirestore, collection, getDocs } = require("firebase/firestore");

const { initializeApp } = require("firebase/app");

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

// Initialize Firebase
const firebaseAppConfig = initializeApp(firebaseConfig);

const db = getFirestore(firebaseAppConfig);
//use body parser
app.use(express.json());

const server = http.createServer(app);

const io = new socketIO.Server(server, {
  path: '/thrive/api/chat-ws',
  cors: {
    origin: "*",
    methods: ['GET', 'POST'],
    allowedHeaders: [],
    credentials: false,
    autoConnect: true,
  }
})

io.on("connection", (socket) => {
  console.log("A client connected.");

  // Handle client disconnection
  socket.on("disconnect", () => {
    console.log("A client disconnected.");
  });
});


app.use("/thrive/api/chat", async (req, res) => {

  const { DOB, messages, uid, chatId } = req.body;

  const pr = collection(db, 'prompt')

  const basePromptSnapshot = await getDocs(pr);

  const basePrompt = basePromptSnapshot.docs.map(doc => doc.data());

  if (!uid || !chatId) {
    return res.status(400).json({ message: "uid or chatId is missing" });
  };

  const zodiacSign = getZodiacSign(DOB);

  let prompt = `
  THRIVE AI, your personal growth companion, is here to assist you in navigating life's journey based on your North Node sign. Ask me anything related to personal growth, self-discovery, relationships, career, and well-being, and I'll provide tailored insights and strategies specific to your North Node sign. Together, let's unlock your full potential, overcome challenges, and live a fulfilling life aligned with your soul's purpose. Share your questions, and I'll guide you on your unique path with the wisdom of your North Node sign.
  `;

  let message = [{ role: "system", content: basePrompt[0].basePrompt }, { role: "user", content: `my Zodiac sign is ${zodiacSign ?? ''}` }, ...messages];

  let controller = null; // Store the AbortController instance

  try {
    // Create a new AbortController instance
    controller = new AbortController();
    const signal = controller.signal;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: message,
        max_tokens: 500,
        stream: true, // For streaming responses
      }),
      signal, // Pass the signal to the fetch request
    });

    const reader = response.body.getReader();

    const decoder = new TextDecoder("utf-8");

    let messagesTemp = "";

    let AIResponseObj = {};

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        console.log("Stream finished.");
        break;
      }
      // Massage and parse the chunk of data
      const chunk = decoder.decode(value);
      const lines = chunk.split("\n");
      const parsedLines = lines
        .map((line) => line.replace(/^data: /, "").trim()) // Remove the "data: " prefix
        .filter((line) => line !== "" && line !== "[DONE]") // Remove empty lines and "[DONE]"
        .map((line) => JSON.parse(line)); // Parse the JSON string

      for (const parsedLine of parsedLines) {
        const { choices } = parsedLine;
        const { delta } = choices[0];
        const { content } = delta;

        AIResponseObj = {
          //  remove undefined string if found from content
          content: content?.replace("undefined", null) ?? '',
          finished: parsedLine.choices[0].finish_reason === "stop" ?? false,
        };

        // Emit the content to connected sockets
        io.emit(`${uid}_${chatId}`, AIResponseObj);

        // console.log(`Received message from OpenAI: ${content}`);
        // Update the UI with the new content
        messagesTemp += content;
      }
    }
    return res.status(200).json({ messages: messagesTemp });
  } catch (err) {
    console.log("err", err);
  }
});

//listen
server.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
});

