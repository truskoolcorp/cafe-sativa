'use client';

import { useState, useRef, useEffect } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function EurekaChat() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: "Hi! I'm Eureka Andersson, Nordic wellness chef at Virtual Café Sativa. How can I help you today?"
    }
  ]);
  const [input, setInput] = useState<string>('');
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    
    const newUserMessage: Message = { role: 'user', content: userMessage };
    setMessages((prev) => [...prev, newUserMessage]);
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat-eureka', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: userMessage }),
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const data = await response.json();
      
      const assistantMessage: Message = {
        role: 'assistant',
        content: data.response
      };
      
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Error:', error);
      const errorMessage: Message = {
        role: 'assistant',
        content: "I'm having trouble connecting right now. Please try again in a moment."
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const quickQuestions = [
    "Suggest a healthy recipe",
    "What's cooking today?",
    "Nordic wellness tips",
    "Upcoming classes"
  ];

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 w-16 h-16 bg-[#C9A961] rounded-full shadow-2xl hover:scale-110 transition-transform flex items-center justify-center text-3xl z-50"
        aria-label="Chat with Eureka"
      >
        👩‍🍳
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 w-[400px] h-[600px] bg-[#2B1810] rounded-lg shadow-2xl flex flex-col z-50 border-2 border-[#5C4033]">
      <div className="bg-gradient-to-r from-[#5C4033] to-[#C07855] p-4 rounded-t-lg flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-[#C9A961] rounded-full flex items-center justify-center text-2xl">
            👩‍🍳
          </div>
          <div>
            <div className="text-[#F5E6D3] font-bold">Chef Eureka</div>
            <div className="text-[#F5E6D3] text-xs opacity-80">Nordic Wellness Expert</div>
          </div>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="text-[#F5E6D3] hover:text-[#C9A961] transition text-2xl"
          aria-label="Close chat"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message, index) => (
          <div
            key={index}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] p-3 rounded-lg ${
                message.role === 'user'
                  ? 'bg-[#C9A961] text-[#2B1810]'
                  : 'bg-[#5C4033] text-[#F5E6D3]'
              }`}
            >
              {message.content}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-[#5C4033] text-[#F5E6D3] p-3 rounded-lg">
              <div className="flex gap-1">
                <span className="animate-bounce">●</span>
                <span className="animate-bounce" style={{ animationDelay: '0.1s' }}>●</span>
                <span className="animate-bounce" style={{ animationDelay: '0.2s' }}>●</span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {messages.length === 1 && (
        <div className="px-4 pb-2">
          <div className="text-[#C9A961] text-xs mb-2">Quick questions:</div>
          <div className="grid grid-cols-2 gap-2">
            {quickQuestions.map((question, index) => (
              <button
                key={index}
                onClick={() => {
                  setInput(question);
                }}
                className="text-xs bg-[#5C4033] text-[#F5E6D3] p-2 rounded hover:bg-[#C07855] transition"
              >
                {question}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="p-4 border-t border-[#5C4033]">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="Ask Eureka anything..."
            className="flex-1 bg-[#5C4033] text-[#F5E6D3] px-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C9A961] placeholder-[#C9A961] placeholder-opacity-50"
            disabled={isLoading}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || isLoading}
            className="bg-[#C9A961] text-[#2B1810] px-6 py-3 rounded-lg hover:bg-[#C07855] transition disabled:opacity-50 disabled:cursor-not-allowed font-bold"
          >
            →
          </button>
        </div>
        <div className="text-[#C9A961] text-xs mt-2 text-center opacity-70">
          Powered by OpenAI
        </div>
      </div>
    </div>
  );
}
