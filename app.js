const express = require('express');
const path = require('path');
const content = require('./data/content');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.render('index', { content });
});

app.listen(PORT, () => {
  console.log(`Veloura Fem running at http://localhost:${PORT}`);
});
