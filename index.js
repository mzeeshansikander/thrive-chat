//boiler plate for express
const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const { getZodiacSign } = require("./getZodiacSign");
const app = express();
const port = 3006;
require("dotenv").config();

const { getFirestore, collection, getDocs } = require("firebase/firestore");

const { initializeApp } = require("firebase/app");
const { default: axios } = require("axios");

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Initialize Firebase
const firebaseAppConfig = initializeApp(firebaseConfig);

const db = getFirestore(firebaseAppConfig);
//use body parser
app.use(express.json());

const server = http.createServer(app);

const io = new socketIO.Server(server, {
  path: "/thrive/api/chat-ws",
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: [],
    credentials: false,
    autoConnect: true,
  },
});

io.on("connection", (socket) => {
  console.log("A client connected.");

  // Handle client disconnection
  socket.on("disconnect", () => {
    console.log("A client disconnected.");
  });
});

app.use("/thrive/api/chat", async (req, res) => {
  const { DOB, messages, uid, chatId } = req.body;

  const pr = collection(db, "prompt");

  const basePromptSnapshot = await getDocs(pr);

  const basePrompt = basePromptSnapshot.docs.map((doc) => doc.data());

  //  console.log('thrive',basePrompt);

  if (!uid || !chatId) {
    return res.status(400).json({ message: "uid or chatId is missing" });
  }

  const northNodeSign = getZodiacSign(DOB);

  let message = [
    { role: "system", content: basePrompt[0].basePrompt },
    { role: "user", content: `my north node sign is ${northNodeSign ?? ""}` },
    ...messages,
  ];

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
      // console.log("line", lines);
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
          content: content?.replace("undefined", null) ?? "",
          finished: parsedLine.choices[0].finish_reason === "stop" ?? false,
        };
        //console.log('content',content);
        // Emit the content to connected sockets
        io.emit(`${uid}_${chatId}`, AIResponseObj);

        // console.log(`Received message from OpenAI: ${content}`);
        // Update the UI with the new content
        messagesTemp += content;
      }
    }

    // Get last object from message array and concatinate with messagesTemp.
    const sentence =
      message[message.length - 1].content +
      " " +
      messagesTemp?.replace("undefined", "");

    console.log("AIResponseObj", sentence.split(" ").length);

    // Update words count
    const { data: sent } = await axios.post(
      "https://us-central1-thrive-8e99c.cloudfunctions.net/updateFirestoreValue",
      {
        uid,
        sentence,
      }
    );

    return res.status(200).json({
      messages: messagesTemp?.replace("undefined", ""),
      wordCount: sent.data.wordCount,
    });
  } catch (err) {
    console.log("err", err);
  }
});

//listen
server.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
});
