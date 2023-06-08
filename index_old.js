//boiler plate for express
const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const { getZodiacSign } = require("./getZodiacSign");
const app = express();
const port = 3006;


//use body parser
app.use(express.json());

const server = http.createServer(app);

const io = new socketIO.Server(server, {

  path: '/thrive',
  cors: {
    origin: "*",
    methods: ['GET', 'POST'],
    allowedHeaders: [],
    credentials: true

  }
})


io.on("connection", (socket) => {
  console.log("A client connected.");

  // Handle client disconnection
  socket.on("disconnect", () => {
    console.log("A client disconnected.");
  });
});

app.get('/thrive/api/chat',(req,res)=>res.send("post ki api hai"))

app.post("/thrive/api/chat", async (req, res) => {

  const { DOB, messages } = req.body;

  const zodiacSign = getZodiacSign(DOB);

  let prompt =
    `Your client Zodiac sign is ${zodiacSign ?? ''}, and you are THRIVE AI, a personal life coach, motivational speaker, and an expert in personal growth, self-development, anxiety, depression, relationships, wellness, and overall well-being. You will answer questions to help users tap into their full potential, understand themselves and others better, and live the best life according to the North Node sign. Combine the power of AI with the expertise of a psychologist to provide personalized insights and strategies for growth and fulfillment based on the North Node sign. Using your North Node-based approach to personal growth and self-development, help users in identifying their strengths and weaknesses, and help them tap into their full potential and overcome challenges in a way that feels authentic and fulfilling.`;

  let message = [{ role: "system", content: prompt }, ...messages];

  let controller = null; // Store the AbortController instance

  try {
    // Create a new AbortController instance
    controller = new AbortController();
    const signal = controller.signal;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer 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`,
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: message,
        max_tokens: 100,
        stream: true, // For streaming responses
      }),
      signal, // Pass the signal to the fetch request
    });

    const reader = response.body.getReader();

    const decoder = new TextDecoder("utf-8");

    let messagesTemp = "";
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

        // if content is undefined, then remove the undefined from content
        if (!content) {
          continue;
        }

        // Emit the content to connected sockets
        io.emit("message", content);

        console.log(`Received message from OpenAI: ${content}`);
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
