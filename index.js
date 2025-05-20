/*const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
//const UserModel = require('./models/Users');
const app = express.json();

app.use(cors());
app.use(express.json());
const mongoUrl= 'mongodb+srv://santoshgudeti:GUDETIsantosh@cluster0.7wsub.mongodb.net/santosh?retryWrites=true&w=majority';
mongoose 
.connect(mongoUrl, {
  userNewUrlParser: true,
})

  .then(() => { 
    console.log('Connected to database');
  })
  .catch((e) => console.log(exports));

app.get('/', async (req, res) => {
  UserModel.find()
    res.send("Success!!!!!!!");
    });
   
app.listen(5000, () => {
  console.log('Server started');
});  */
