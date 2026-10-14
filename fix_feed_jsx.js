const fs = require('fs');

const homePath = '../DatingApp/src/screens/CustomerHomeScreen.tsx';
let homeCode = fs.readFileSync(homePath, 'utf8');

// Replace from loadingRestaurants to the end of the scrollview content
const targetRegex = /\) : loadingRestaurants && restaurants\.length === 0 \? \([\s\S]*?\{\/\* 6\. POPULAR DISHES SECTION \(ONLY REAL DISHES WITH PHOTOS\) \*\/\}[\s\S]*?<\/ScrollView>\s*<\/View>\s*\)\s*\}\s*<\/ScrollView>/;

const newSection = `) : loadingRestaurants && restaurants.length === 0 ? (
          /* Modern Skeleton Cards */
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.restaurantsScroll}
          >
            {[1, 2, 3].map((key) => (
              <View key={key} style={styles.skeletonCard}>
                <View style={styles.skeletonImg}>
                  <ActivityIndicator size="small" color="#94A3B8" />
                </View>
                <View style={styles.skeletonInfoWrap}>
                  <View style={styles.skeletonTitleBar} />
                  <View style={styles.skeletonSubBar} />
                  <View style={styles.skeletonMetaBar} />
                </View>
              </View>
            ))}
          </ScrollView>
        ) : !isServiceAvailable ? (
          /* ============================================================ */
          /* REQUIREMENT 3: NO ONLINE STORES/ITEMS -> SERVICE NOT AVAILABLE */
          /* (NO Categories, NO Category Images, NO Product Images)       */
          /* ============================================================ */
          <View style={{
            marginHorizontal: 16,
            marginVertical: 40,
            padding: 28,
            backgroundColor: '#FFFFFF',
            borderRadius: 24,
            borderWidth: 1.5,
            borderColor: '#E2E8F0',
            alignItems: 'center',
            shadowColor: '#000000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.05,
            shadowRadius: 10,
            elevation: 3,
          }}>
            <View style={{
              width: 76,
              height: 76,
              borderRadius: 38,
              backgroundColor: '#FEF2F2',
              borderWidth: 1.5,
              borderColor: '#FCA5A5',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16,
            }}>
              <Text style={{ fontSize: 36 }}>🚫</Text>
            </View>
            <Text style={{
              fontSize: 20,
              fontWeight: '900',
              color: '#0F172A',
              textAlign: 'center',
              marginBottom: 8,
              letterSpacing: 0.2,
            }}>
              Service not available
            </Text>
            <Text style={{
              fontSize: 13.5,
              color: '#64748B',
              textAlign: 'center',
              lineHeight: 20,
              marginBottom: 22,
              paddingHorizontal: 12,
            }}>
              Currently no online stores or in-stock items are available in your area. Please check back shortly.
            </Text>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => fetchOnlineRestaurants(true)}
              style={{
                backgroundColor: '#0F172A',
                paddingHorizontal: 22,
                paddingVertical: 11,
                borderRadius: 14,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 13.5 }}>🔄 Check Again</Text>
            </TouchableOpacity>
          </View>
        ) : (
          /* ============================================================ */
          /* ELIGIBLE ONLINE STORES & REAL IN-STOCK ITEMS EXIST          */
          /* ============================================================ */
          <>
            {/* 1. DYNAMIC REAL CATEGORIES (ONLY ACTIVE ONES) */}
            {activeInStockCategories.length > 0 && (
              <View style={styles.categoriesContainer}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  nestedScrollEnabled={true}
                  contentContainerStyle={styles.categoryTwoRowScroll}
                >
                  <View style={styles.categoryTwoRowWrapper}>
                    {/* Row 1 */}
                    <View style={styles.categoryRow}>
                      {dynamicCategoryRows.row1.map((item: any) => renderCategoryPill(item))}
                    </View>
                    {/* Row 2 */}
                    <View style={styles.categoryRow}>
                      {dynamicCategoryRows.row2.map((item: any) => renderCategoryPill(item))}
                    </View>
                  </View>
                </ScrollView>
              </View>
            )}

            {/* 2. REAL ONLINE STORE CARDS */}
            {selectedCat !== 'all' ? (
              <View style={{ paddingHorizontal: 16 }}>
                <View style={[styles.sectionHeaderRow, { paddingHorizontal: 0 }]}>
                  <Text style={styles.sectionTitle}>
                    {activeCategoryObj?.icon || '🏪'} {activeCategoryName} Stores ({filteredRestaurants.length})
                  </Text>
                  <TouchableOpacity onPress={() => setSelectedCat('all')}>
                    <Text style={styles.seeAllText}>Clear Filter ✕</Text>
                  </TouchableOpacity>
                </View>

                {filteredRestaurants.length === 0 ? (
                  <View style={styles.emptyRestoWrap}>
                    <Text style={{ fontSize: 36 }}>{activeCategoryObj?.icon || '🏪'}</Text>
                    <Text style={styles.emptyRestoTitle}>
                      No {activeCategoryName} stores online right now.
                    </Text>
                    <TouchableOpacity style={styles.emptyRetryBtn} onPress={() => setSelectedCat('all')}>
                      <Text style={styles.emptyRetryText}>⚡ View All Stores</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  filteredRestaurants.map((resto) => renderVerticalStoreCard(resto))
                )}
              </View>
            ) : (
              <View style={{ paddingHorizontal: 16 }}>
                <View style={[styles.sectionHeaderRow, { paddingHorizontal: 0, marginBottom: 12 }]}>
                  <Text style={styles.sectionTitle}>
                    🏪 Online Stores & Merchants ({eligibleOnlineStores.length})
                  </Text>
                </View>
                {eligibleOnlineStores.map((resto) => renderVerticalStoreCard(resto))}
              </View>
            )}

            {/* 3. REAL IN-STOCK DISHES / PRODUCTS ONLY */}
            {availableInStockDishes.length > 0 && (
              <View style={{ marginTop: 14 }}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>
                    {selectedCat === 'all' ? '✨ Available In-Stock Items' : \`✨ Available in \${activeCategoryName}\`}
                  </Text>
                  {selectedCat !== 'all' ? (
                    <TouchableOpacity onPress={() => setSelectedCat('all')}>
                      <Text style={styles.seeAllText}>View All →</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                <ScrollView
                  horizontal
                  nestedScrollEnabled={true}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.popularScroll}
                >
                  {availableInStockDishes
                    .filter((d) => {
                      if (selectedCat === 'all') return true;
                      const catName = String(d.category || d.categoryName || '').toLowerCase();
                      return catName.includes(filterCatNormalized) || filterCatNormalized.includes(catName);
                    })
                    .map((dish, idx) => {
                      const resto = dish.restaurant || {};
                      const hasRealImg = Boolean(
                        dish.image &&
                        typeof dish.image === 'string' &&
                        !dish.image.includes('unsplash') &&
                        (dish.image.startsWith('http') || dish.image.startsWith('file://') || dish.image.startsWith('data:image'))
                      );
                      const dishPrice = dish.price ? (String(dish.price).startsWith('₹') ? dish.price : \`₹\${dish.price}\`) : (dish.rawPrice ? \`₹\${dish.rawPrice}\` : '');

                      return (
                        <TouchableOpacity
                          key={\`avail_dish_\${dish.id || dish._id || idx}\`}
                          style={styles.popularCard}
                          activeOpacity={0.9}
                          onPress={() => {
                            if (dish.restaurant) {
                              navigation.navigate('ItemDetailsScreen', {
                                item: dish,
                                restaurantId: dish.restaurant._id || dish.restaurant.id,
                                restaurant: dish.restaurant.rawUser || dish.restaurant,
                                customerCoords,
                              });
                            }
                          }}
                        >
                          <View style={styles.popularImgWrap}>
                            {hasRealImg ? (
                              <Image source={{ uri: dish.image }} style={styles.popularImg} resizeMode="cover" />
                            ) : (
                              <View style={[styles.popularImg, { backgroundColor: '#FEF3C7', alignItems: 'center', justifyContent: 'center' }]}>
                                <Text style={{ fontSize: 32 }}>📦</Text>
                              </View>
                            )}
                          </View>
                          <Text style={styles.popularDishName} numberOfLines={1}>
                            {dish.name}
                          </Text>
                          <Text style={{ fontSize: 11, color: '#64748B', fontWeight: '600', marginTop: 2 }} numberOfLines={1}>
                            🏪 {resto.name || resto.restaurantName || 'Online Store'}
                          </Text>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                            <Text style={styles.popularPrice}>{dishPrice}</Text>
                            <Text style={styles.popularRating}>★ {formatRating(dish.rating || resto.rating)}</Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                </ScrollView>
              </View>
            )}
          </>
        )}
        </>
      )}
      </ScrollView>`;

homeCode = homeCode.replace(targetRegex, newSection);

// Also remove categoriesContainer from being rendered above loadingRestaurants if present
// Let's check if categoriesContainer is rendered twice
const firstCatPos = homeCode.indexOf('styles.categoriesContainer');
const lastCatPos = homeCode.lastIndexOf('styles.categoriesContainer');
if (firstCatPos !== lastCatPos && firstCatPos !== -1) {
  // Remove the earlier one above isOutOfZone
  const duplicateBlock = /\{\/\* ============================================================ \*\/\}[\s\S]*?\{\/\* 3\. 2-ROW REAL CATEGORIES CONTAINER \(ROUND WHITE CARDS\) \*\/\}[\s\S]*?<\/View>\s*<\/ScrollView>\s*<\/View>/;
  homeCode = homeCode.replace(duplicateBlock, '');
}

fs.writeFileSync(homePath, homeCode, 'utf8');
console.log('CustomerHomeScreen.tsx successfully cleaned & updated!');
