const express = require("express");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const path = require("path");
const dbPath = path.join(__dirname, "twitterClone.db");
const app = express();
app.use(express.json());
let db = null;

const initializeDbAndServer = async () => {
  try {
    db = await open({ filename: dbPath, driver: sqlite3.Database });
    app.listen(3000, () => {
      console.log("Server running at http://localhost:3000");
    });
  } catch (e) {
    console.log(`DB Error:${e.message}`);
    process.exit(1);
  }
};
initializeDbAndServer();

const hashPassword = (password) => {};

const authenticateToken = (request, response, next) => {
  const authHeader = request.headers["authorization"];
  if (authHeader === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    const jwtToken = authHeader.split(" ")[1];
    const secretKey = "my_secret_key";
    if (jwtToken === undefined) {
      response.status(401);
      response.send("Invalid JWT Token");
    } else {
      jwt.verify(jwtToken, secretKey, async (err, payload) => {
        if (err) {
          response.status(401);
          response.send("Invalid JWT Token");
        } else {
          request.user = payload;
          next();
        }
      });
    }
  }
};

// API 1: Register a new user
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const checkUserStatus = `select * from user where username = '${username}';`;
  const dbRes = await db.get(checkUserStatus);
  if (dbRes === undefined) {
    if (password.length >= 6) {
      const hashedPassword = await bcrypt.hash(password, 10);
      const createNewUser = `insert into user (username,password,name,gender)
    values('${username}','${hashedPassword}','${name}','${gender}');`;
      await db.run(createNewUser);
      response.send("User created successfully");
    } else {
      response.status(400);
      response.send("Password is too short");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

// API 2: Login a user
app.post("/login/", async (request, response) => {
  const payload = request.body;
  const secretKey = "my_secret_key";
  const { username, password } = request.body;
  const checkUser = `select * from user where username = '${username}';`;
  const dbUser = await db.get(checkUser);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const jwtToken = jwt.sign(payload, secretKey);
      response.send({ jwtToken: jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

// API 3: Get tweets of followers
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { username } = request.user;
  const getUser_id = `select * from user where username = '${username}' ;`;
  const dbRes = await db.get(getUser_id);
  const userId = dbRes.user_id;
  const getUserTweetsQuery = `select * from user inner join follower on user.user_id = follower.follower_user_id where user_id ='${userId}'`;
  const follower = await db.all(getUserTweetsQuery);
  const getFollowerIdArray = follower.map((e) => e.following_user_id);
  const getTweetsQuery = `select username,tweet,date_time as dateTime from tweet inner join user on tweet.user_id = user.user_id where tweet.user_id in (${getFollowerIdArray}) order by date_time desc limit 4`;
  const getTweets = await db.all(getTweetsQuery);
  response.send(getTweets);
});

// API 4: Get the list of people the user follows
app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username } = request.user;
  const getUserId = `select user_id from user where username = '${username}';`;
  const userId = await db.get(getUserId);
  const getFollowerIdQuery = `select following_user_id from follower where follower_user_id = '${userId.user_id}';`;
  const followerId = await db.all(getFollowerIdQuery);
  const followingIdArray = followerId.map((e) => e.following_user_id);
  const getNameQuery = `select name from user where user_id in (${followingIdArray});`;
  const name = await db.all(getNameQuery);
  response.send(name);
});

// API 5: Get the list of followers of the user
app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { username } = request.user;
  const getUserId = `select user_id from user where username = '${username}';`;
  const userId = await db.get(getUserId);
  const followerUserIdQuery = `select follower_user_id from follower where following_user_id = ${userId.user_id};`;
  const dbResponse = await db.all(followerUserIdQuery);
  const followerIds = dbResponse.map((e) => e.follower_user_id);
  const getFollowerNames = `select name from user where user_id in (${followerIds})`;
  const getNames = await db.all(getFollowerNames);
  response.send(getNames);
});

app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { username } = request.user;
  const { tweetId } = request.params;

  const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}'`;
  const userIdResult = await db.get(getUserIdQuery);
  const userId = userIdResult.user_id;

  const getFollowingIdsQuery = `SELECT following_user_id FROM follower WHERE follower_user_id = ${userId}`;
  const followingUsers = await db.all(getFollowingIdsQuery);
  const followingIds = followingUsers.map((f) => f.following_user_id);

  const getTweetQuery = `
    SELECT tweet,
    (SELECT COUNT(like_id) FROM like WHERE like.tweet_id = ${tweetId}) AS likes,
    (SELECT COUNT(reply_id) FROM reply WHERE reply.tweet_id = ${tweetId}) AS replies,
    date_time AS dateTime
    FROM tweet
    WHERE user_id IN (${followingIds.join(",")}) AND tweet_id = ${tweetId}
  `;
  const tweet = await db.get(getTweetQuery);

  if (tweet !== undefined) {
    response.send(tweet);
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

// API 7: Get users who liked the tweet
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;

    const getLikesQuery = `
    SELECT user.username 
    FROM like INNER JOIN user ON like.user_id = user.user_id
    WHERE like.tweet_id = ${tweetId}`;
    const likedUsers = await db.all(getLikesQuery);

    if (likedUsers.length > 0) {
      response.send({ likes: likedUsers.map((user) => user.username) });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

//API 8: Get replies for the tweet
app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;

    const getRepliesQuery = `
    SELECT user.name, reply.reply 
    FROM reply 
    INNER JOIN user ON reply.user_id = user.user_id
    WHERE reply.tweet_id = ${tweetId}
  `;
    const replies = await db.all(getRepliesQuery);

    if (replies.length > 0) {
      response.send({ replies: replies });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

//API 9: Get all tweets of the user
app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request.user;

  const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}'`;
  const userIdResult = await db.get(getUserIdQuery);
  const userId = userIdResult.user_id;

  const getTweetsQuery = `
    SELECT tweet,
    (SELECT COUNT(like_id) FROM like WHERE like.tweet_id = tweet.tweet_id) AS likes,
    (SELECT COUNT(reply_id) FROM reply WHERE reply.tweet_id = tweet.tweet_id) AS replies,
    date_time AS dateTime
    FROM tweet
    WHERE user_id = ${userId}
  `;
  const tweets = await db.all(getTweetsQuery);

  if (tweets.length > 0) {
    response.send(tweets);
  } else {
    response.status(400);
    response.send("No tweets found");
  }
});

// API 10: Post a new tweet
app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request.user;
  const { tweet } = request.body;

  const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}'`;
  const userIdResult = await db.get(getUserIdQuery);
  const userId = userIdResult.user_id;

  const dateTime = new Date().toISOString();

  const createTweetQuery = `
    INSERT INTO tweet (tweet, user_id, date_time) 
    VALUES ('${tweet}', ${userId}, '${dateTime}')
  `;
  await db.run(createTweetQuery);
  response.send("Created a Tweet");
});

// API 11: Delete a tweet
app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { username } = request.user;
    const { tweetId } = request.params;

    const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}'`;
    const userIdResult = await db.get(getUserIdQuery);
    const userId = userIdResult.user_id;

    const getUserTweetsQuery = `SELECT tweet_id FROM tweet WHERE user_id = ${userId}`;
    const userTweets = await db.all(getUserTweetsQuery);

    const tweetIds = userTweets.map((tweet) => tweet.tweet_id);

    if (tweetIds.includes(parseInt(tweetId))) {
      const deleteTweetQuery = `DELETE FROM tweet WHERE tweet_id = ${parseInt(
        tweetId
      )}`;
      await db.run(deleteTweetQuery);
      response.send("Tweet Removed");
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

module.exports = app;
