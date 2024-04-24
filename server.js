// Author: Klein Mancini Cairney
// Student ID: S2140472

// Import necessary modules
const express = require('express');
const session = require('express-session');
const Datastore = require('nedb');
const bcrypt = require('bcryptjs');
const mustacheExpress = require('mustache-express');
const multer = require('multer');
const bodyParser = require('body-parser');

// Create an Express application
const app = express();
const PORT = 3000;

// Initialize NeDB databases
const users = new Datastore({ filename: 'users.db', autoload: true });
const foodItems = new Datastore({ filename: 'foodItems.db', autoload: true });
const messages = new Datastore({ filename: 'messages.db', autoload: true });

// Initialize Mustache Express as the view engine
app.engine('mustache', mustacheExpress());
app.set('view engine', 'mustache');
app.set('views', __dirname + '/views');

// Middleware to serve static files from 'public' directory
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

//Use body parser
app.use(bodyParser.urlencoded({ extended: true }));

// Session middleware
app.use(session({
    secret: 'Kleins food related secret for this project',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: 'auto' }
}));

// Set up storage engine for multer
const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        cb(null, 'public/images/uploaded_images')
    },
    filename: function(req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname)
    }
});

const upload = multer({ storage: storage });

// Public Routes
app.get('/', (req, res) => {
    if (req.session.user) {
        res.redirect('/browse');
    } else {
        res.render('index', {
            title: "Welcome",
            message: "Connecting surplus food growers with food pantries."
        });
    }
});

app.get('/contact', (req, res) => {
    const success = req.query.success;
    res.render('contact', { successMessage: success ? "Thank you for your feedback, we will get back to you as soon as possible" : "" });
});

app.get('/about', (req, res) => res.render('about'));
app.get('/login', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));

app.get('/browse', (req, res) => {
    if (req.session.user) {
        foodItems.find({}).exec((err, items) => {
            if (err) {
                // Handle the error accordingly
                res.status(500).send('Error fetching items.');
                return;
            }

            // Enhance items with status color and username
            const promises = items.map(item =>
                new Promise(resolve => {
                    // Determine the status color
                    let statusColor;
                    switch (item.status) {
                        case 'Fresh':
                            statusColor = 'green';
                            break;
                        case 'Near Expiry':
                            statusColor = 'orange';
                            break;
                        case 'Damaged':
                            statusColor = 'red';
                            break;
                        default:
                            statusColor = 'grey';
                            break;
                    }
                    item.statusColor = statusColor; // Add the status color to the item

                    // Find the username for the userId
                    users.findOne({ _id: item.userId }, (err, userDoc) => {
                        // Fallback to a default value if the user is not found
                        item.username = userDoc ? userDoc.username : 'Unknown';
                        resolve(item);
                    });
                })
            );

            // When all usernames and status colors are resolved, render the page
            Promise.all(promises).then(completeItems => {
                res.render('browse', { items: completeItems });
            });
        });
    } else {
        res.redirect('/login');
    }
});

// Admin Dashboard
app.get('/admin', (req, res) => {
    if (!req.session.user || !req.session.user.isAdmin) {
        return res.status(403).send('Access denied. Admins only.');
    }

    // Fetch all users
    users.find({}, (err, userList) => {
        if (err) {
            console.error('Error fetching users:', err);
            return res.status(500).send('Error fetching users.');
        }

        // Initiate an array to hold all user detail promises
        const userDetailsPromises = userList.map(user => {
            return new Promise(resolve => {
                // Fetch food items
                foodItems.find({ userId: user._id }, (err, userFoodItems) => {
                    if (err) {
                        console.error('Error fetching food items for user:', user.username, err);
                        userFoodItems = []; // Continue with empty array on error
                    }

                    // Fetch messages
                    messages.find({ userId: user._id }, (err, userMessages) => {
                        if (err) {
                            console.error('Error fetching messages for user:', user.username, err);
                            userMessages = []; // Continue with empty array on error
                        }

                        // Resolve with full user details including items and messages
                        resolve({
                            ...user,
                            foodItems: userFoodItems,
                            messages: userMessages
                        });
                    });
                });
            });
        });

        Promise.all(userDetailsPromises).then(usersDetails => {
            // Filter out any potential null values if error handling was not to resolve
            const filteredUsersDetails = usersDetails.filter(details => details);
            console.log('All users details:', filteredUsersDetails);
            res.render('admin', { users: filteredUsersDetails });
        }).catch(err => {
            console.error('Error resolving user details:', err);
            res.status(500).send('Error resolving user details.');
        });
    });
});

// Remove an individual item
app.post('/remove-item', (req, res) => {
    if (!req.session.user || !req.session.user.isAdmin) {
        return res.status(403).send('Unauthorized access.');
    }

    const { itemId } = req.body;
    foodItems.remove({ _id: itemId }, {}, (err) => {
        if (err) {
            console.error('Failed to remove item:', err);
            return res.status(500).send('Failed to remove item.');
        }
        res.redirect('/admin?success=Item removed');
    });
});

// Remove a user and all their items and messages
app.post('/remove-user', (req, res) => {
    if (!req.session.user || !req.session.user.isAdmin) {
        return res.status(403).send('Unauthorized access.');
    }

    const { userId } = req.body;

    users.remove({ _id: userId }, {}, (err) => {
        if (err) {
            console.error('Failed to remove user:', err);
            return res.status(500).send('Failed to remove user.');
        }

        // Cascade delete user's items and messages
        Promise.all([
            foodItems.remove({ userId: userId }, { multi: true }),
            messages.remove({ userId: userId }, { multi: true })
        ])
        .then(() => {
            res.redirect('/admin?success=User and all associated data removed');
        })
        .catch(err => {
            console.error('Failed to remove associated data:', err);
            res.status(500).send('Failed to remove associated data.');
        });
    });
});

app.get('/addItems', (req, res) => {
    if (req.session.user) {
        const todayDate = new Date().toISOString().split('T')[0];
        const successMessage = req.query.success; // Retrieve the success message from the query parameter
        res.render('addItems', { todayDate, successMessage }); // Pass the success message to the template
    } else {
        res.redirect('/login');
    }
});

// Authentication and Account Management
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    users.findOne({ username }, (err, user) => {
        if (err) {
            // Handle database errors
            res.status(500).send("Database error during login.");
            return;
        }
        if (!user) {
            // User not found
            res.render('login', { error: 'User not found.' });
            return;
        }

        bcrypt.compare(password, user.password, (err, isMatch) => {
            if (err) {
                // Handle hashing comparison errors
                res.status(500).send("Error checking credentials.");
                return;
            }
            if (!isMatch) {
                // Passwords do not match
                res.render('login', { error: 'Invalid credentials.' });
            } else {
                // Successful login
                req.session.user = { id: user._id, username: user.username, isAdmin: user.isAdmin };

                // Redirect based on admin status
                if (user.isAdmin) {
                    res.redirect('/admin');
                } else {
                    res.redirect('/browse');
                }
            }
        });
    });
});

app.post('/register', async (req, res) => {
    const { username, password, email } = req.body;  // Include email in the destructured variables
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
        username,
        password: hashedPassword,
        email,  // Include email when creating the user object
        isAdmin: false  // Assume users are not admins by default
    };

    users.insert(newUser, (err) => {
        if (err) {
            res.render('register', { error: 'Error registering new user.' });
        } else {
            res.redirect('/login'); // Redirect to the login page after successful registration
        }
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            res.redirect('/browse');
        } else {
            res.redirect('/login');
        }
    });
});

app.post('/add-food-item', upload.single('image'), (req, res) => {
    const { name, description, quantity, expiryDate, status} = req.body;
    const imagePath = req.file ? 'images/uploaded_images/' + req.file.filename : '';
    if (req.session.user) {
        const foodItem = {
            name,
            description,
            quantity,
            expiryDate,
            status,
            imagePath,
            userId: req.session.user.id,
            selected: false
        };
        foodItems.insert(foodItem, (err) => {
            if (err) {
                res.status(500).send('Error adding item.');
            } else {
                res.redirect('/addItems?success=We appreciate your donation. Please take the goods to Govan Home and Education Link Project. Thank you for supporting the community and reducing waste!');
            }
        });
    } else {
        res.status(403).send('Unauthorized');
    }
});

app.post('/select-item', (req, res) => {
    const { itemId, quantity } = req.body;
    if (!req.session.user) {
        res.redirect('/login');
        return;
    }
    foodItems.findOne({ _id: itemId }, (err, item) => {
        if (err || !item) {
            res.status(500).send('Item not found.');
            return;
        }
        const newQuantity = item.quantity - parseInt(quantity, 10);
        if (newQuantity <= 0) {
            // If the new quantity is 0 or less, remove the item from the database
            foodItems.remove({ _id: itemId }, {}, (err, numRemoved) => {
                if (err) {
                    res.status(500).send('Failed to remove item.');
                    return;
                }
                res.send(`<script>alert('All available units of ${item.name} were selected and it has been removed from listings.'); window.location.href='/browse';</script>`);
            });
        } else {
            // Otherwise, update the quantity in the database
            foodItems.update({ _id: itemId }, { $set: { quantity: newQuantity } }, {}, (err, numUpdated) => {
                if (err) {
                    res.status(500).send('Failed to update item quantity.');
                    return;
                }
                res.send(`<script>alert('${quantity} portions of ${item.name} were successfully selected, thank you for helping reduce waste!.'); window.location.href='/browse';</script>`);
            });
        }
    });
});

app.post('/send-message', (req, res) => {
    const { name, email, message: userMessage } = req.body; // Avoid name collision with 'message' from the request object
    // Access the user ID from the session if available
    const userId = req.session.user ? req.session.user.id : null;

    // Create a message object including the user ID
    const newMessage = {
        name,
        email,
        message: userMessage,
        userId, // Store the user ID with the message
        date: new Date() // Capture the date when the message was sent
    };

    // Insert the message into the database
    messages.insert(newMessage, (err, newDoc) => {
        if (err) {
            // Handle error by sending a status or redirecting with an error message
            res.status(500).send("Failed to send message.");
        } else {
            // Redirect with a success message
            res.redirect('/contact?success=true');
        }
    });
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});