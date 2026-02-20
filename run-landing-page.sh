#!/bin/bash

echo "🚀 Starting Clira Landing Page..."
echo "📍 Location: ./landing-page"
echo "🌐 URL: http://localhost:8080"
echo ""

# Navigate to the landing page directory
cd landing-page

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Start the development server
echo "🔧 Starting development server..."
npm run dev 