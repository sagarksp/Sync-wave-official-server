const gamesCatalog = [
  { id: "snake", title: "Snake", category: "offline", players: "1", difficulty: "Casual", featured: true, trendingScore: 93, coins: 12, xp: 18 },
  { id: "snake-ladder", title: "Snake & Ladder", category: "offline", players: "1-4", difficulty: "Classic", featured: true, trendingScore: 88, coins: 14, xp: 20 },
  { id: "tic-tac-toe", title: "Tic Tac Toe", category: "offline", players: "1-2", difficulty: "Quick", featured: false, trendingScore: 81, coins: 10, xp: 15 },
  { id: "chess-ai", title: "Chess vs AI", category: "offline", players: "1", difficulty: "Strategic", featured: true, trendingScore: 90, coins: 18, xp: 28 },
  { id: "carrom", title: "Carrom", category: "offline", players: "1-2", difficulty: "Skill", featured: false, trendingScore: 76, coins: 16, xp: 24 },
  { id: "sudoku", title: "Sudoku", category: "offline", players: "1", difficulty: "Logic", featured: false, trendingScore: 84, coins: 15, xp: 25 },
  { id: "memory-match", title: "Memory Match", category: "offline", players: "1", difficulty: "Focus", featured: false, trendingScore: 79, coins: 12, xp: 18 },
  { id: "2048", title: "2048", category: "offline", players: "1", difficulty: "Puzzle", featured: true, trendingScore: 92, coins: 16, xp: 26 },
  { id: "flappy-wave", title: "Flappy Bird Clone", category: "offline", players: "1", difficulty: "Arcade", featured: false, trendingScore: 86, coins: 13, xp: 22 },
  { id: "ludo-online", title: "Ludo Online", category: "online", players: "2-4", difficulty: "Classic", featured: true, trendingScore: 96, coins: 24, xp: 36 },
  { id: "chess-online", title: "Chess Online", category: "online", players: "2", difficulty: "Competitive", featured: true, trendingScore: 97, coins: 28, xp: 42 },
  { id: "carrom-online", title: "Carrom Online", category: "online", players: "2", difficulty: "Skill", featured: false, trendingScore: 89, coins: 24, xp: 36 },
  { id: "tic-tac-toe-online", title: "Tic Tac Toe Online", category: "online", players: "2", difficulty: "Quick", featured: false, trendingScore: 82, coins: 18, xp: 26 },
];

const achievements = [
  { key: "first_win", title: "First Victory", description: "Win your first SyncWave game.", icon: "crown", gameId: "all", trigger: { metric: "wins", target: 1 }, reward: { coins: 75, xp: 100 } },
  { key: "ten_matches", title: "Table Regular", description: "Play ten games across the hub.", icon: "spark", gameId: "all", trigger: { metric: "totalGamesPlayed", target: 10 }, reward: { coins: 120, xp: 180 } },
  { key: "five_streak", title: "Hot Streak", description: "Win five games in a row.", icon: "flame", gameId: "all", trigger: { metric: "winStreak", target: 5 }, reward: { coins: 220, xp: 350 } },
  { key: "puzzle_climber", title: "Puzzle Climber", description: "Score 1024 or higher in 2048.", icon: "tile", gameId: "2048", trigger: { metric: "bestScore", target: 1024 }, reward: { coins: 160, xp: 240 } },
  { key: "snake_charmer", title: "Snake Charmer", description: "Score 25 points in Snake.", icon: "route", gameId: "snake", trigger: { metric: "bestScore", target: 25 }, reward: { coins: 140, xp: 220 } },
];

function findGame(gameId) {
  return gamesCatalog.find((game) => game.id === gameId) || null;
}

module.exports = { achievements, findGame, gamesCatalog };
