# ورقــــــه - Multiplayer Card Game

A complete, beginner-friendly online card game project built with Node.js, Socket.IO, and React.

## How to Run the Game

### 1. Software Requirements
- **Node.js**: You need Node.js installed on your computer to run the server and the game.

### 2. How to Install Node.js
- Go to [nodejs.org](https://nodejs.org/).
- Download the **LTS (Long Term Support)** version for your operating system.
- Run the installer and follow the prompts.
- To verify installation, open a terminal and type: `node -v` and `npm -v`.

### 3. Install Dependencies
- Open a terminal or command prompt in the project folder.
- Run the following command to install all necessary libraries:
  ```bash
  npm install
  ```

### 4. Start the Server
- In the same terminal, run the following command:
  ```bash
  npm run dev
  ```
- This will start the server using `node server.js`.
- You should see a message saying: `Server running on http://localhost:3000`.

### 5. How to Connect
- Open your web browser (Chrome, Firefox, etc.).
- Go to: `http://localhost:3000`.
- To play with 4 people:
  - Open 4 different browser tabs or windows.
  - One person clicks **Host Game** and shares the Room Code.
  - The other 3 enter the code and click **Join**.

---

## Game Rules (Engine Specification)

### 1. Players
- The game is for exactly **4 players**.
- Each player plays individually.

### 2. Deck Composition (36 cards + 2 jokers)
| Suit | Cards |
|------|-------|
| ♠ Spades | 6, 7, 8, 9, 10, J, Q, K, A |
| ♥ Hearts | 6, 7, 8, 9, 10, J, Q, K, A |
| ♦ Diamonds | 7, 8, 9, 10, J, Q, K, A |
| ♣ Clubs | 7, 8, 9, 10, J, Q, K, A |
| Special | Red Joker, Black Joker |

### 3. Dealing
- Each player receives **9 cards**.
- The player to the dealer's right starts the bidding.

### 4. Bidding (Calling Tricks)
- Players call how many tricks they can take (Min: 6, Max: 8).
- Players can **Pass**.
- If all pass, the dealer must bid between 5 and 8.

### 5. Trump Selection
- The bid winner chooses the **Trump Suit**.
- Trump cards are stronger than any other suit (except Jokers).

### 6. Joker Rules
- **Black Joker**: Burns (becomes useless) if not played by the end of Round 3.
- **Red Joker**: Burns if played before the Black Joker has been played.
- **Contracts ≤ 6 Exception**: If a player holds both the Red and Black Joker and the contract is 6 or lower:
  1. The Black Joker must be played first, followed by the Red Joker.
  2. If the Red Joker is played before the Black Joker → it is considered a mistake, and only the Red Joker burns.
  3. If the order is correct (Black first, then Red) → it counts as the strongest trump, and play continues without burning.

### 7. Objective
- Win at least the number of tricks you called to win the round.
