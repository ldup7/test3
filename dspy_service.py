from flask import Flask, request, jsonify
import dspy
from datetime import datetime, timedelta
import requests

try:
    from dspy import Example
except ImportError as e:
    print(f"dspy module not found or class definition missing: {e}")
    raise

app = Flask(__name__)

@app.route('/')
def home():
    return "DSPy service est en cours d'exécution !"

# Fonction pour obtenir la date actuelle au format '%Y-%m-%d'
def get_current_date():
    return datetime.now().strftime('%Y-%m-%d')


# Fonction pour obtenir la date d'il y a une semaine
def get_date_one_week_ago():
    one_week_ago = datetime.now() - timedelta(days=7)
    return one_week_ago.strftime('%Y-%m-%d')

# Créer un message système détaillé basé sur la requête
def create_system_message(query, embed_sources=False):
    current_date = get_current_date()
    one_week_ago_date = get_date_one_week_ago()
    template_text = (f"Voici ma requête : \"{query}\". Répondez en français avec des informations aussi récentes que possible "
                     f"entre le {one_week_ago_date} et le {current_date}. Assurez-vous d'inclure des dates et des descriptions pertinentes. "
                     f"Si vous trouvez des résultats pertinents, incluez-les dans la réponse avec les sources utilisées. "
                     f"Si vous ne trouvez aucun résultat pertinent, répondez par \"Aucun résultat pertinent trouvé\".")
    if embed_sources:
        template_text += " Retournez les sources utilisées dans la réponse avec des annotations de style markdown numérotées de manière itérative."
    
    example = Example(text=template_text)
    return example.text

# Créer un message utilisateur pour inclure les résultats de recherche
def create_user_message(results):
    template_text = f"Voici les meilleurs résultats d'une recherche de similarité : {results}. Utilisez ces informations pour fournir une réponse détaillée et complète en incluant les sources."
    example = Example(text=template_text)
    return example.text

# Créer des questions de suivi basées sur la requête et les sources
def create_followup_questions_message(query, sources):
    template_text = f"Générez 3 questions de suivi basées sur le texte suivant : {sources}. La requête de recherche initiale est : '{query}'. Retournez les questions au format tableau : ['Question 1', 'Question 2', 'Question 3']"
    example = Example(text=template_text)
    follow_up_questions_text = example.text
    
    followup_questions = follow_up_questions_text.strip("[]").replace("'", "").split(", ")
    
    followup_questions_json = {
        "original": query,
        "followUp": followup_questions
    }
    
    return followup_questions_json

@app.route('/process-system-message', methods=['POST'])
def process_system_message_route():
    data = request.json
    query = data.get('query')
    embed_sources = data.get('embed_sources', True)
    if not query:
        return jsonify({'error': 'Query parameter is required'}), 400
    system_message = create_system_message(query, embed_sources)
    return jsonify({'system_message': system_message})

@app.route('/process-user-message', methods=['POST'])
def process_user_message_route():
    data = request.json
    results = data.get('results')
    if not results:
        return jsonify({'error': 'Results parameter is required'}), 400
    user_message = create_user_message(results)
    return jsonify({'user_message': user_message})

@app.route('/process-followup-questions-message', methods=['POST'])
def process_followup_questions_message_route():
    data = request.json
    query = data.get('query')
    sources = data.get('sources')
    if not query or not sources:
        return jsonify({'error': 'Query and sources parameters are required'}), 400
    followup_questions_message = create_followup_questions_message(query, sources)
    return jsonify(followup_questions_message)

@app.route('/process-query', methods=['POST'])
def process_query_route():
    data = request.json
    query = data.get('query')
    category = data.get('category')
    if not query or not category:
        return jsonify({'error': 'Query and category parameters are required'}), 400
    
    # Map the category to a specific template text
    category_map = {
        "market_trends": "Tendances du marché : ",
        "competitor_activity": "Activités des concurrents : ",
        "financial_performance": "Performances financières : ",
        "marketing_strategies": "Stratégies marketing et commerciales : ",
        "partnerships_collaborations": "Partenariats et collaborations : ",
        "startups_innovations": "Startups et innovations : ",
        "market_opportunities": "Opportunités de marché : ",
        "threats": "Risques et menaces : ",
        "hr_trends": "Tendances RH : ",
        "recruitment_training": "Recrutement et formation : ",
        "upcoming_events": "Événements à venir : ",
        "event_reviews": "Retour sur événements : "
    }
    
    if category not in category_map:
        return jsonify({'error': 'Invalid category parameter'}), 400
    
    template_text = category_map[category] + query
    system_message = create_system_message(template_text, embed_sources=True)
    return jsonify({'message': system_message})

if __name__ == '__main__':
    app.run(port=5000)
