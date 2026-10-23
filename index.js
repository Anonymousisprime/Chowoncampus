
const readline = require("readline");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const ORDERS_FILE = path.join(__dirname, "orders.json");
const DELIVERY_FEE = 300;

const PAYMENT = {
  method: "PalmPay",
  accountNumber: "9169398221",
  accountName: "Adebajo Olamiposi Adetola",
  receiptWhatsApp: "2349169398221"
};

const ADMIN = {
  username: "admin",
  password: "AdminDemo2026!"
};

const restaurants = [
  {
    id: "CB",
    name: "Campus Bites",
    username: "campusbites",
    password: "CBdemo2026!",
    menu: [
      { id: 1, name: "Jollof Rice", price: 2500 },
      { id: 2, name: "Fried Rice", price: 3000 },
      { id: 3, name: "Chicken", price: 1500 },
      { id: 4, name: "Chicken and Chips", price: 3500 },
      { id: 5, name: "Bottle Water", price: 500 }
    ]
  },
  {
    id: "MK",
    name: "Mama's Kitchen",
    username: "mamaskitchen",
    password: "MKdemo2026!",
    menu: [
      { id: 1, name: "Beans and Plantain", price: 2000 },
      { id: 2, name: "Spaghetti", price: 1800 },
      { id: 3, name: "Rice and Stew", price: 2200 },
      { id: 4, name: "Chicken", price: 1500 },
      { id: 5, name: "Bottle Water", price: 500 }
    ]
  }
];

// Fictional agents for local demonstration only.
const agents = [
  { name: "Demo Agent 1", distance: 0.3, available: true },
  { name: "Demo Agent 2", distance: 0.7, available: true },
  { name: "Demo Agent 3", distance: 1.2, available: true }
];

function ask(question) {
  return new Promise(resolve => {
    rl.question(question, answer => resolve(answer.trim()));
  });
}

function money(amount) {
  return "₦" + Number(amount).toLocaleString("en-NG");
}

function loadOrders() {
  try {
    if (!fs.existsSync(ORDERS_FILE)) {
      fs.writeFileSync(ORDERS_FILE, "[]", "utf8");
    }

    const orders = JSON.parse(
      fs.readFileSync(ORDERS_FILE, "utf8")
    );

    return Array.isArray(orders) ? orders : [];
  } catch (error) {
    console.error("Could not load orders:", error.message);
    return [];
  }
}

function saveOrders(orders) {
  const temporaryFile = ORDERS_FILE + ".tmp";

  fs.writeFileSync(
    temporaryFile,
    JSON.stringify(orders, null, 2),
    "utf8"
  );

  fs.renameSync(temporaryFile, ORDERS_FILE);
}

function findOrder(orderId) {
  return loadOrders().find(
    order => order.id.toLowerCase() === orderId.toLowerCase()
  );
}

function updateOrder(orderId, changes) {
  const orders = loadOrders();

  const index = orders.findIndex(
    order => order.id.toLowerCase() === orderId.toLowerCase()
  );

  if (index === -1) return null;

  orders[index] = {
    ...orders[index],
    ...changes,
    updatedAt: new Date().toISOString()
  };

  saveOrders(orders);
  return orders[index];
}

function calculateSubtotal(items) {
  return items.reduce(
    (total, item) => total + item.price * item.quantity,
    0
  );
}

function showOrder(order) {
  console.log("\n========== ORDER DETAILS ==========");
  console.log("Order ID:", order.id);
  console.log("Restaurant:", order.restaurant);
  console.log("Delivery location:", order.location);

  console.log("\nItems:");

  for (const item of order.items) {
    console.log(
      `${item.name} x${item.quantity}: ${money(item.price * item.quantity)}`
    );
  }

  console.log("-----------------------------------");
  console.log("Food subtotal:", money(order.subtotal));
  console.log("Delivery fee:", money(order.deliveryFee));
  console.log("Total:", money(order.total));
  console.log("-----------------------------------");
  console.log(
    "Transfer reported:",
    order.transferReported ? "YES" : "NO"
  );
  console.log(
    "Receipt seen by admin:",
    order.receiptSeen ? "YES" : "NO"
  );
  console.log("Payment status:", order.paymentStatus);
  console.log("Order status:", order.status);
  console.log("===================================");
}

function makeReceiptWhatsAppLink(order) {
  const message =
    `Hello Chowoncampus, here is my payment receipt.\n` +
    `Order ID: ${order.id}\n` +
    `Restaurant: ${order.restaurant}\n` +
    `Amount: ${money(order.total)}\n` +
    `Please review my payment receipt.`;

  return (
    `https://wa.me/${PAYMENT.receiptWhatsApp}?text=` +
    encodeURIComponent(message)
  );
}

function showPaymentDetails(order) {
  console.log("\n========== PAYMENT DETAILS ==========");
  console.log("Payment method:", PAYMENT.method);
  console.log("Account number:", PAYMENT.accountNumber);
  console.log("Account name:", PAYMENT.accountName);
  console.log("Amount to transfer:", money(order.total));
  console.log("-------------------------------------");
  console.log("Your order ID:", order.id);
  console.log("=====================================");
}

async function chooseRestaurant() {
  console.log("\n========== RESTAURANTS ==========");

  restaurants.forEach((restaurant, index) => {
    console.log(`${index + 1}. ${restaurant.name}`);
  });

  const choice = Number(await ask("Choose a restaurant: "));

  if (
    !Number.isInteger(choice) ||
    choice < 1 ||
    choice > restaurants.length
  ) {
    console.log("Invalid restaurant selection.");
    return null;
  }

  return restaurants[choice - 1];
}

// Customer checkout, including the transfer confirmation action.
async function placeOrder() {
  const restaurant = await chooseRestaurant();
  if (!restaurant) return;

  const cart = [];

  while (true) {
    console.log(`\n========== ${restaurant.name.toUpperCase()} MENU ==========`);

    restaurant.menu.forEach(item => {
      console.log(`${item.id}. ${item.name} — ${money(item.price)}`);
    });

    console.log("0. Continue to checkout");

    const choice = Number(await ask("Choose an item: "));

    if (choice === 0) break;

    const food = restaurant.menu.find(item => item.id === choice);

    if (!food) {
      console.log("Invalid menu item.");
      continue;
    }

    const quantity = Number(await ask("Enter quantity: "));

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
      console.log("Enter a quantity between 1 and 50.");
      continue;
    }

    const existing = cart.find(item => item.id === food.id);

    if (existing) {
      existing.quantity += quantity;
    } else {
      cart.push({
        id: food.id,
        name: food.name,
        price: food.price,
        quantity
      });
    }

    console.log(`${food.name} added to your cart.`);
  }

  if (cart.length === 0) {
    console.log("Your cart is empty.");
    return;
  }

  const subtotal = calculateSubtotal(cart);
  const total = subtotal + DELIVERY_FEE;

  console.log("\n========== CHECKOUT ==========");

  for (const item of cart) {
    console.log(
      `${item.name} x${item.quantity}: ${money(item.price * item.quantity)}`
    );
  }

  console.log("--------------------------------");
  console.log("Food subtotal:", money(subtotal));
  console.log("Delivery fee:", money(DELIVERY_FEE));
  console.log("TOTAL:", money(total));

  const location = await ask("\nEnter your campus delivery location: ");

  if (!location) {
    console.log("Delivery location is required.");
    return;
  }

  const confirm = (
    await ask("Confirm your order? (YES/NO): ")
  ).toUpperCase();

  if (confirm !== "YES") {
    console.log("Order cancelled.");
    return;
  }

  const order = {
    id: "COC-" + crypto.randomUUID().slice(0, 8).toUpperCase(),
    restaurantId: restaurant.id,
    restaurant: restaurant.name,
    items: cart,
    location,
    subtotal,
    deliveryFee: DELIVERY_FEE,
    total,

    transferReported: false,
    transferReportedAt: null,
    transferNotificationSeen: false,

    receiptSeen: false,
    receiptSeenAt: null,

    paymentStatus: "Awaiting transfer",
    paymentVerifiedAt: null,

    restaurantNotified: false,
    assignedAgent: null,

    status: "Awaiting payment",
    createdAt: new Date().toISOString()
  };

  const orders = loadOrders();
  orders.push(order);
  saveOrders(orders);

  console.log("\nOrder created successfully!");
  console.log("KEEP YOUR ORDER ID:", order.id);

  showPaymentDetails(order);

  console.log("\nAfter making your transfer, use the option below.");
  console.log("1. I HAVE TRANSFERRED THE MONEY");
  console.log("0. I WILL PAY LATER");

  const paymentChoice = await ask("\nChoose an option: ");

  if (paymentChoice === "1") {
    await reportTransferAtCheckout(order.id);
  } else {
    console.log("\nYour order has been saved.");
    console.log("You can report your transfer when you return.");
  }
}

// This action is called directly from checkout.
async function reportTransferAtCheckout(orderId) {
  const order = findOrder(orderId);

  if (!order) {
    console.log("Order not found.");
    return;
  }

  if (order.transferReported) {
    console.log("A transfer has already been reported for this order.");
    console.log(makeReceiptWhatsAppLink(order));
    return;
  }

  const confirm = (
    await ask(
      "\nHave you actually transferred the displayed amount? (YES/NO): "
    )
  ).toUpperCase();

  if (confirm !== "YES") {
    console.log("Transfer not reported. Your order remains awaiting payment.");
    return;
  }

  const updated = updateOrder(order.id, {
    transferReported: true,
    transferReportedAt: new Date().toISOString(),
    transferNotificationSeen: false,
    paymentStatus: "Transfer reported — awaiting review",
    status: "Awaiting receipt review"
  });

  if (!updated) {
    console.log("Could not save your transfer report. Please try again.");
    return;
  }

  console.log("\nTransfer report submitted!");
  console.log("A new notification has been recorded for the admin dashboard.");

  console.log("\nSEND YOUR RECEIPT:");
  console.log(makeReceiptWhatsAppLink(updated));
  console.log("\nOpen the link and attach your actual receipt image.");
  console.log("The order will remain hidden from the restaurant until");
  console.log("the admin marks the receipt as seen.");

  console.log(
    "\nImportant: reporting a transfer does not confirm that the money arrived."
  );
}

async function trackOrder() {
  const orderId = await ask("Enter your order ID: ");
  const order = findOrder(orderId);

  if (!order) {
    console.log("Order not found.");
    return;
  }

  showOrder(order);
}

// Restaurant dashboard only shows orders whose receipts the admin has seen.
async function restaurantLogin() {
  const username = await ask("Restaurant username: ");
  const password = await ask("Restaurant password: ");

  const restaurant = restaurants.find(
    item => item.username === username && item.password === password
  );

  if (!restaurant) {
    console.log("Invalid restaurant login.");
    return;
  }

  console.log(`\nWelcome to ${restaurant.name}.`);

  while (true) {
    console.log("\n========== RESTAURANT DASHBOARD ==========");
    console.log("1. View available orders");
    console.log("2. View an order");
    console.log("3. Update order status");
    console.log("0. Log out");

    const choice = await ask("Choose an option: ");

    if (choice === "0") break;

    const visibleOrders = loadOrders().filter(
      order =>
        order.restaurantId === restaurant.id &&
        order.receiptSeen === true
    );

    if (choice === "1") {
      if (visibleOrders.length === 0) {
        console.log("No orders have been released to your restaurant yet.");
        continue;
      }

      visibleOrders.forEach(order => {
        console.log(
          `${order.id} | ${order.status} | ${money(order.total)}`
        );
      });
    } else if (choice === "2") {
      const orderId = await ask("Enter order ID: ");

      const order = visibleOrders.find(
        item => item.id.toLowerCase() === orderId.toLowerCase()
      );

      if (!order) {
        console.log("Order not found or not released to your restaurant.");
      } else {
        showOrder(order);
      }
    } else if (choice === "3") {
      const orderId = await ask("Enter order ID: ");

      const order = visibleOrders.find(
        item => item.id.toLowerCase() === orderId.toLowerCase()
      );

      if (!order) {
        console.log("Order not found or not released to your restaurant.");
        continue;
      }

      if (order.paymentStatus !== "Paid — manually verified") {
        console.log("Payment has not been verified by the admin.");
        console.log("The order cannot be processed yet.");
        continue;
      }

      console.log("\n1. Accepted");
      console.log("2. Preparing");
      console.log("3. Ready for pickup");
      console.log("4. Picked up");
      console.log("5. Delivered");
      console.log("6. Rejected");

      const statusChoice = await ask("Choose status: ");

      const statuses = {
        "1": "Accepted",
        "2": "Preparing",
        "3": "Ready for pickup",
        "4": "Picked up",
        "5": "Delivered",
        "6": "Rejected"
      };

      const status = statuses[statusChoice];

      if (!status) {
        console.log("Invalid status.");
        continue;
      }

      updateOrder(order.id, { status });
      console.log("Order status updated:", status);

      if (status === "Ready for pickup") {
        await dispatchOrder(order.id);
      }
    } else {
      console.log("Invalid option.");
    }
  }
}

function showTransferNotifications() {
  const orders = loadOrders().filter(order => order.transferReported);

  console.log("\n========== PAYMENT NOTIFICATIONS ==========");

  if (orders.length === 0) {
    console.log("No customer transfer reports yet.");
    return;
  }

  const unseen = orders.filter(
    order => order.transferNotificationSeen !== true
  );

  console.log("Unseen notifications:", unseen.length);
  console.log("-------------------------------------------");

  orders
    .slice()
    .sort(
      (a, b) =>
        new Date(b.transferReportedAt || 0) -
        new Date(a.transferReportedAt || 0)
    )
    .forEach(order => {
      console.log(
        `${order.transferNotificationSeen ? "[SEEN]" : "[NEW NOTIFICATION]"} ` +
        `${order.id} | ${order.restaurant} | ${money(order.total)}`
      );

      console.log("Reported at:", order.transferReportedAt || "Unknown");
      console.log("Payment:", order.paymentStatus);
      console.log("-------------------------------------------");
    });
}

async function adminLogin() {
  const username = await ask("Admin username: ");
  const password = await ask("Admin password: ");

  if (username !== ADMIN.username || password !== ADMIN.password) {
    console.log("Invalid admin login.");
    return;
  }

  console.log("\nWelcome to the Chowoncampus Admin Dashboard.");

  while (true) {
    const orders = loadOrders();
    const unseenCount = orders.filter(
      order =>
        order.transferReported &&
        order.transferNotificationSeen !== true
    ).length;

    console.log("\n========== ADMIN DASHBOARD ==========");
    console.log(`New transfer notifications: ${unseenCount}`);
    console.log("1. View all orders");
    console.log("2. View payment notifications");
    console.log("3. Mark a transfer notification as seen");
    console.log("4. Mark receipt as SEEN (release order to restaurant)");
    console.log("5. Verify payment manually");
    console.log("6. Update order status");
    console.log("0. Log out");

    const choice = await ask("Choose an option: ");

    if (choice === "0") break;

    if (choice === "1") {
      const allOrders = loadOrders();

      if (allOrders.length === 0) {
        console.log("No orders yet.");
      } else {
        allOrders.forEach(order => {
          console.log(
            `${order.id} | ${order.restaurant} | ${money(order.total)} | ` +
            `${order.paymentStatus} | Receipt seen: ${order.receiptSeen ? "YES" : "NO"}`
          );
        });
      }
    } else if (choice === "2") {
      showTransferNotifications();
    } else if (choice === "3") {
      const orderId = await ask("Enter order ID: ");
      const order = findOrder(orderId);

      if (!order) {
        console.log("Order not found.");
        continue;
      }

      if (!order.transferReported) {
        console.log("This customer has not reported a transfer.");
        continue;
      }

      updateOrder(order.id, {
        transferNotificationSeen: true
      });

      console.log("Transfer notification marked as seen.");
      console.log("This does not verify the payment or release the order.");
    } else if (choice === "4") {
      const orderId = await ask("Enter order ID: ");
      const order = findOrder(orderId);

      if (!order) {
        console.log("Order not found.");
        continue;
      }

      console.log("\nOpen WhatsApp and inspect the actual receipt first.");
      console.log("Marking a receipt as seen does not prove payment.");

      const confirm = (
        await ask("Have you actually viewed the receipt? (YES/NO): ")
      ).toUpperCase();

      if (confirm !== "YES") {
        console.log("Receipt was not marked as seen.");
        continue;
      }

      updateOrder(order.id, {
        receiptSeen: true,
        receiptSeenAt: new Date().toISOString()
      });

      console.log("Receipt marked as seen.");
      console.log("The order is now visible in the restaurant dashboard.");
      console.log("No automatic restaurant WhatsApp notification was sent.");
    } else if (choice === "5") {
      const orderId = await ask("Enter order ID: ");
      const order = findOrder(orderId);

      if (!order) {
        console.log("Order not found.");
        continue;
      }

      console.log("Expected payment:", money(order.total));
      console.log("Check your actual PalmPay transaction history.");

      const confirm = (
        await ask("Has the money actually arrived? (YES/NO): ")
      ).toUpperCase();

      if (confirm !== "YES") {
        console.log("Payment remains unverified.");
        continue;
      }

      updateOrder(order.id, {
        paymentStatus: "Paid — manually verified",
        paymentVerifiedAt: new Date().toISOString()
      });

      console.log("Payment verified and saved.");
    } else if (choice === "6") {
      const orderId = await ask("Enter order ID: ");
      const order = findOrder(orderId);

      if (!order) {
        console.log("Order not found.");
        continue;
      }

      console.log("\n1. Awaiting payment");
      console.log("2. Awaiting receipt review");
      console.log("3. Accepted");
      console.log("4. Preparing");
      console.log("5. Ready for pickup");
      console.log("6. Picked up");
      console.log("7. Delivered");
      console.log("8. Rejected");

      const statusChoice = await ask("Choose status: ");

      const statuses = {
        "1": "Awaiting payment",
        "2": "Awaiting receipt review",
        "3": "Accepted",
        "4": "Preparing",
        "5": "Ready for pickup",
        "6": "Picked up",
        "7": "Delivered",
        "8": "Rejected"
      };

      const status = statuses[statusChoice];

      if (!status) {
        console.log("Invalid status.");
        continue;
      }

      updateOrder(order.id, { status });
      console.log("Order status updated:", status);

      if (status === "Ready for pickup") {
        await dispatchOrder(order.id);
      }
    } else {
      console.log("Invalid option.");
    }
  }
}

// Simulated nearest-agent dispatch. No real drivers are contacted.
async function dispatchOrder(orderId) {
  const availableAgents = agents
    .filter(agent => agent.available)
    .sort((a, b) => a.distance - b.distance);

  if (availableAgents.length === 0) {
    console.log("No demo delivery agents are available.");
    return;
  }

  for (const agent of availableAgents) {
    console.log(`\nOffering delivery to ${agent.name}.`);
    console.log(`Demo distance: ${agent.distance} km.`);
    console.log("60 seconds to accept or decline.");

    const response = await askWithTimeout(
      "Type ACCEPT or DECLINE: ",
      60000
    );

    if (response === null) {
      console.log("Offer timed out. Trying the next agent.");
      continue;
    }

    if (response.toUpperCase() === "ACCEPT") {
      agent.available = false;

      updateOrder(orderId, {
        assignedAgent: agent.name,
        status: "Delivery assigned"
      });

      console.log(`${agent.name} accepted the demo delivery.`);
      return;
    }

    console.log("Offer declined. Trying the next agent.");
  }

  console.log("No demo agent accepted the delivery.");
}

function askWithTimeout(question, timeoutMs) {
  return new Promise(resolve => {
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) return;

      finished = true;
      rl.removeListener("line", onLine);
      console.log("\nResponse time expired.");
      resolve(null);
    }, timeoutMs);

    function onLine(answer) {
      if (finished) return;

      finished = true;
      clearTimeout(timer);
      rl.removeListener("line", onLine);
      resolve(answer.trim());
    }

    console.log(question);
    rl.once("line", onLine);
  });
}

async function mainMenu() {
  console.log("\n==================================");
  console.log("         CHOWONCAMPUS");
  console.log("       Campus Food Ordering");
  console.log("==================================");

  while (true) {
    console.log("\n1. Place an order");
    console.log("2. Track an order");
    console.log("3. Restaurant login");
    console.log("4. Admin login");
    console.log("0. Exit");

    const choice = await ask("\nChoose an option: ");

    try {
      if (choice === "1") {
        await placeOrder();
      } else if (choice === "2") {
        await trackOrder();
      } else if (choice === "3") {
        await restaurantLogin();
      } else if (choice === "4") {
        await adminLogin();
      } else if (choice === "0") {
        console.log("Thanks for using Chowoncampus!");
        break;
      } else {
        console.log("Invalid option.");
      }
    } catch (error) {
      console.error("Something went wrong:", error.message);
    }
  }

  rl.close();
}

mainMenu();
