import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import multer from "multer";
import fs from "fs";

const db = new Database("bomberos_v4.db");

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + "-" + file.originalname);
  },
});
const upload = multer({ storage });

// Initialize DB
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    avatarUrl TEXT
  );
  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT
  );
  CREATE TABLE IF NOT EXISTS challenges (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    categoryId TEXT NOT NULL,
    imageUrl TEXT,
    youtubeUrl TEXT,
    scoringType TEXT DEFAULT 'TIME_ASC',
    FOREIGN KEY(categoryId) REFERENCES categories(id)
  );
  CREATE TABLE IF NOT EXISTS challenge_files (
    id TEXT PRIMARY KEY,
    challengeId TEXT NOT NULL,
    filename TEXT NOT NULL,
    originalName TEXT NOT NULL,
    mimeType TEXT NOT NULL,
    FOREIGN KEY(challengeId) REFERENCES challenges(id)
  );
  CREATE TABLE IF NOT EXISTS results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT NOT NULL,
    challengeId TEXT NOT NULL,
    timeMs INTEGER NOT NULL,
    score REAL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(userId) REFERENCES users(id),
    FOREIGN KEY(challengeId) REFERENCES challenges(id)
  );
`);

// Migration: Add scoringType and score columns if they don't exist
try {
  db.prepare("ALTER TABLE challenges ADD COLUMN scoringType TEXT DEFAULT 'TIME_ASC'").run();
} catch (e) {}
try {
  db.prepare("ALTER TABLE results ADD COLUMN score REAL").run();
} catch (e) {}

// Migration: Add avatarUrl if it doesn't exist (for existing databases)
try {
  db.prepare("ALTER TABLE users ADD COLUMN avatarUrl TEXT").run();
} catch (e) {
  // Column already exists or other error
}

// Migration: Clean up duplicate names and ensure unique constraint
try {
  // Delete duplicates keeping only the first one found for each name
  db.prepare(`
    DELETE FROM users 
    WHERE id NOT IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY name ORDER BY id) as rn
        FROM users
      ) WHERE rn = 1
    )
  `).run();
  
  // Try to create a unique index if it doesn't exist (SQLite doesn't support ALTER TABLE ADD UNIQUE easily)
  db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_name ON users(name)").run();
} catch (e) {
  console.error("Migration error:", e);
}

// Seed categories and challenges if empty
const categoryCount = db.prepare("SELECT COUNT(*) as count FROM categories").get() as { count: number };
if (categoryCount.count === 0) {
  const insertCat = db.prepare("INSERT INTO categories (id, name, description) VALUES (?, ?, ?)");
  insertCat.run("cat1", "Agua", "Maniobras con mangueras y lanzas.");
  insertCat.run("cat2", "Rescate", "Técnicas de extracción y salvamento.");
  insertCat.run("cat3", "Físico", "Pruebas de resistencia y fuerza.");
  insertCat.run("cat4", "Preparación", "Equipamiento y protocolos.");
}

const challengeCount = db.prepare("SELECT COUNT(*) as count FROM challenges").get() as { count: number };
if (challengeCount.count === 0) {
  const insert = db.prepare("INSERT INTO challenges (id, title, description, categoryId, imageUrl) VALUES (?, ?, ?, ?, ?)");
  insert.run("c1", "Despliegue de Manguera", "Desplegar 20m de manguera de 45mm y conectar a lanza.", "cat1", "https://picsum.photos/seed/firehose/800/400");
  insert.run("c2", "Rescate en Espacio Confinado", "Localizar y extraer maniquí de 70kg en laberinto.", "cat2", "https://picsum.photos/seed/rescue/800/400");
  insert.run("c3", "Equipamiento Completo (EPI)", "Colocarse el equipo completo incluyendo ERA en el menor tiempo.", "cat4", "https://picsum.photos/seed/firefighter/800/400");
  insert.run("c4", "Ascenso con Carga", "Subir 3 plantas con una manguera al hombro.", "cat3", "https://picsum.photos/seed/climb/800/400");
}

async function startServer() {
  try {
    const app = express();
    const httpServer = createServer(app);
    const io = new Server(httpServer, {
      cors: {
        origin: "*",
      },
    });

    const PORT = 3000;

    app.use(express.json());
    app.use("/uploads", express.static(uploadsDir));

    app.get("/ping", (req, res) => res.send("pong"));

  // API Routes
  app.get("/api/categories", (req, res) => {
    const categories = db.prepare("SELECT * FROM categories").all();
    res.json(categories);
  });

  app.post("/api/categories", (req, res) => {
    const { name, description } = req.body;
    const id = "cat" + Math.random().toString(36).substr(2, 9);
    db.prepare("INSERT INTO categories (id, name, description) VALUES (?, ?, ?)").run(id, name, description);
    const newCategory = { id, name, description };
    io.emit("new_category", newCategory);
    res.json(newCategory);
  });

  app.put("/api/categories/:id", (req, res) => {
    const { id } = req.params;
    const { name, description } = req.body;
    db.prepare("UPDATE categories SET name = ?, description = ? WHERE id = ?").run(name, description, id);
    const updatedCategory = { id, name, description };
    io.emit("update_category", updatedCategory);
    res.json(updatedCategory);
  });

  app.get("/api/challenges", (req, res) => {
    const challenges = db.prepare("SELECT * FROM challenges").all() as any[];
    for (const challenge of challenges) {
      challenge.files = db.prepare("SELECT * FROM challenge_files WHERE challengeId = ?").all(challenge.id);
    }
    res.json(challenges);
  });

  app.post("/api/challenges", (req, res) => {
    const { title, description, categoryId, imageUrl, youtubeUrl, scoringType } = req.body;
    const id = "c" + Math.random().toString(36).substr(2, 9);
    db.prepare("INSERT INTO challenges (id, title, description, categoryId, imageUrl, youtubeUrl, scoringType) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, title, description, categoryId, imageUrl, youtubeUrl, scoringType || 'TIME_ASC');
    const newChallenge = { id, title, description, categoryId, imageUrl, youtubeUrl, scoringType: scoringType || 'TIME_ASC', files: [] };
    io.emit("new_challenge", newChallenge);
    res.json(newChallenge);
  });

  app.put("/api/challenges/:id", (req, res) => {
    const { id } = req.params;
    const { title, description, categoryId, imageUrl, youtubeUrl, scoringType } = req.body;
    db.prepare("UPDATE challenges SET title = ?, description = ?, categoryId = ?, imageUrl = ?, youtubeUrl = ?, scoringType = ? WHERE id = ?").run(title, description, categoryId, imageUrl, youtubeUrl, scoringType || 'TIME_ASC', id);
    const updatedChallenge = { id, title, description, categoryId, imageUrl, youtubeUrl, scoringType: scoringType || 'TIME_ASC' };
    // Fetch files to include in update
    (updatedChallenge as any).files = db.prepare("SELECT * FROM challenge_files WHERE challengeId = ?").all(id);
    io.emit("update_challenge", updatedChallenge);
    res.json(updatedChallenge);
  });

  app.post("/api/challenges/:id/files", upload.array("files"), (req, res) => {
    const { id } = req.params;
    const files = req.files as Express.Multer.File[];
    const insertedFiles = [];

    for (const file of files) {
      const fileId = "f" + Math.random().toString(36).substr(2, 9);
      db.prepare("INSERT INTO challenge_files (id, challengeId, filename, originalName, mimeType) VALUES (?, ?, ?, ?, ?)").run(
        fileId,
        id,
        file.filename,
        file.originalname,
        file.mimetype
      );
      insertedFiles.push({ id: fileId, challengeId: id, filename: file.filename, originalName: file.originalname, mimeType: file.mimetype });
    }

    const challenge = db.prepare("SELECT * FROM challenges WHERE id = ?").get(id) as any;
    challenge.files = db.prepare("SELECT * FROM challenge_files WHERE challengeId = ?").all(id);
    io.emit("update_challenge", challenge);

    res.json(insertedFiles);
  });

  app.get("/api/leaderboard", (req, res) => {
    const leaderboard = db.prepare(`
      SELECT r.userId, r.timeMs, r.score, r.timestamp, u.name as userName, u.avatarUrl as userAvatar, c.title as challengeTitle, c.id as challengeId, c.scoringType
      FROM results r
      JOIN users u ON r.userId = u.id
      JOIN challenges c ON r.challengeId = c.id
      ORDER BY r.timestamp DESC
      LIMIT 1000
    `).all();
    res.json(leaderboard);
  });

  app.get("/api/leaderboard/general", (req, res) => {
    const challenges = db.prepare("SELECT * FROM challenges").all() as any[];
    const userPoints: Record<string, { userId: string, userName: string, userAvatar: string, points: number }> = {};
    
    for (const challenge of challenges) {
      let orderBy = "r.timeMs ASC";
      if (challenge.scoringType === 'TIME_DESC') orderBy = "r.timeMs DESC";
      if (challenge.scoringType === 'COUNT_DESC') orderBy = "r.score DESC, r.timeMs ASC";

      const results = db.prepare(`
        SELECT r.userId, r.timeMs, r.score, u.name as userName, u.avatarUrl as userAvatar
        FROM results r
        JOIN users u ON r.userId = u.id
        WHERE r.challengeId = ?
        ORDER BY ${orderBy}
      `).all(challenge.id) as any[];
      
      // Get best result per user for this challenge
      const bestResults: any[] = [];
      const seenUsers = new Set();
      for (const r of results) {
        if (!seenUsers.has(r.userId)) {
          bestResults.push(r);
          seenUsers.add(r.userId);
        }
      }
      
      bestResults.forEach((r, index) => {
        const points = Math.max(0, 1000 - (index * 25));
        if (!userPoints[r.userId]) {
          userPoints[r.userId] = {
            userId: r.userId,
            userName: r.userName,
            userAvatar: r.userAvatar,
            points: 0
          };
        }
        userPoints[r.userId].points += points;
      });
    }
    
    const sortedLeaderboard = Object.values(userPoints).sort((a, b) => b.points - a.points);
    res.json(sortedLeaderboard);
  });

  app.get("/api/users", (req, res) => {
    const users = db.prepare("SELECT * FROM users ORDER BY name ASC").all();
    res.json(users);
  });

  app.post("/api/users/profile", upload.single("avatar"), (req, res) => {
    const { id, name } = req.body;
    let avatarUrl = req.body.avatarUrl;

    if (req.file) {
      avatarUrl = `/uploads/${req.file.filename}`;
    }

    // Check if name is taken by another user
    const existingUserWithName = db.prepare("SELECT id FROM users WHERE name = ?").get(name) as { id: string } | undefined;
    if (existingUserWithName && existingUserWithName.id !== id) {
      return res.status(400).json({ error: "El nombre ya está en uso por otro bombero." });
    }

    const userExists = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
    if (userExists) {
      db.prepare("UPDATE users SET name = ?, avatarUrl = ? WHERE id = ?").run(name, avatarUrl, id);
    } else {
      db.prepare("INSERT INTO users (id, name, avatarUrl) VALUES (?, ?, ?)").run(id, name, avatarUrl);
    }

    const updatedUser = { id, name, avatarUrl };
    res.json(updatedUser);
  });

  app.post("/api/results", (req, res) => {
    const { userId, userName, userAvatar, challengeId, timeMs, score } = req.body;
    
    // Ensure user exists
    const userExists = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
    if (!userExists) {
      db.prepare("INSERT INTO users (id, name, avatarUrl) VALUES (?, ?, ?)").run(userId, userName, userAvatar);
    } else {
      db.prepare("UPDATE users SET name = ?, avatarUrl = ? WHERE id = ?").run(userName, userAvatar, userId);
    }

    db.prepare("INSERT INTO results (userId, challengeId, timeMs, score) VALUES (?, ?, ?, ?)").run(userId, challengeId, timeMs, score);
    
    const newResult = { userId, userName, challengeId, timeMs, score, timestamp: new Date().toISOString() };
    io.emit("new_result", newResult);
    
    res.json({ success: true });
  });

  app.get("/api/export", (req, res) => {
    const categories = db.prepare("SELECT * FROM categories").all();
    const challenges = db.prepare("SELECT * FROM challenges").all() as any[];
    for (const challenge of challenges) {
      challenge.files = db.prepare("SELECT * FROM challenge_files WHERE challengeId = ?").all(challenge.id);
    }
    const results = db.prepare("SELECT * FROM results").all();
    const users = db.prepare("SELECT * FROM users").all();

    const data = {
      categories,
      challenges,
      results,
      users,
      exportedAt: new Date().toISOString()
    };

    res.setHeader('Content-disposition', 'attachment; filename=bombero_backup.json');
    res.setHeader('Content-type', 'application/json');
    res.write(JSON.stringify(data, null, 2));
    res.end();
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(process.cwd(), "dist", "index.html"));
    });
  }

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);
    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
    });
  });

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
  } catch (error) {
    console.error("CRITICAL: Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
